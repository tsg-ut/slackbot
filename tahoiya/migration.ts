/**
 * One-time migration script from old tahoiya data to new format.
 * Run via: npx ts-node tahoiya/migration.ts
 */
import {randomUUID} from 'crypto';
import fs from 'fs';
import path from 'path';
import {promisify} from 'util';
import {open} from 'sqlite';
import sqlite3 from 'sqlite3';
import {db} from '../lib/firestore';
import type {StoredTheme} from './types';
import {SOURCE_LABELS} from './utils';

const readFile = promisify(fs.readFile);

async function migrateSqliteThemes() {
	const dbPath = path.join(__dirname, 'themes.sqlite3');
	if (!fs.existsSync(dbPath)) {
		console.log('No sqlite3 db found, skipping theme migration');
		return;
	}

	const sqliteDb = await open({filename: dbPath, driver: sqlite3.Database});
	const rows = await sqliteDb.all('SELECT * FROM themes');

	console.log(`Migrating ${rows.length} themes from sqlite3...`);

	for (const row of rows) {
		const stored: StoredTheme = {
			id: randomUUID(),
			submittedBy: row.user,
			submittedAt: (row.ts ?? 0) * 1000,
			used: row.done === 1,
			usedAt: row.done === 1 ? (row.ts ?? 0) * 1000 : null,
			theme: {
				type: 'dictionary',
				word: row.word,
				ruby: row.ruby,
				meaning: row.meaning,
				source: row.source,
				sourceString: SOURCE_LABELS[row.source as keyof typeof SOURCE_LABELS] ?? row.source,
				sourceUrl: row.url,
			},
		};

		if (db) {
			await db.collection('tahoiya_themes').doc(stored.id).set(stored);
		}
		console.log(`Migrated theme: ${row.ruby}`);
	}

	await sqliteDb.close();
	console.log('Theme migration complete');
}

async function migrateStateRatings() {
	const statePath = path.join(__dirname, 'state.json');
	if (!fs.existsSync(statePath)) {
		console.log('No state.json found, skipping ratings migration');
		return;
	}

	const raw = await readFile(statePath, 'utf-8');
	const oldState = JSON.parse(raw);
	const oldRatings: Record<string, {timestamp: string; rating: number}[]> = oldState.ratings ?? {};

	const newRatings: Record<string, number> = {};
	for (const [userId, ratingHistory] of Object.entries(oldRatings)) {
		const sumScore = ratingHistory.reduce((acc, r) => acc + r.rating, 0);
		// Approximate mapping: sum * 20 + 500, clamped to [0, 1000]
		newRatings[userId] = Math.min(1000, Math.max(0, sumScore * 20 + 500));
	}

	if (db) {
		await db.collection('states').doc('tahoiya').set({
			ratings: newRatings,
			authorHistory: oldState.authorHistory ?? [],
			normalGame: null,
			dailyGame: null,
			gamesPlayed: {},
			dailyStatusMessageTs: null,
		}, {merge: true});
	}

	console.log(`Migrated ratings for ${Object.keys(newRatings).length} users`);
}

// Achievement ID → counter name mapping (for achievements that previously used unlock())
const achievementCounterMap: Record<string, string> = {
	tahoiya: 'tahoiya-participate',
	'daily-tahoiya-theme': 'daily-tahoiya-theme',
	'tahoiya-over6': 'tahoiya-over-6',
	'tahoiya-over10': 'tahoiya-over-10',
	'tahoiya-down10': 'tahoiya-down-10',
	'tahoiya-deceive': 'tahoiya-deceive-once',
	'tahoiya-deceive3': 'tahoiya-deceive-3-once',
	'tahoiya-5bet': 'tahoiya-5-bet',
	'tahoiya-singularity': 'tahoiya-singularity',
	'tahoiya-positive-coins-without-win': 'tahoiya-positive-without-win',
	'tahoiya-deceive-each-other': 'tahoiya-deceive-each-other',
	'tahoiya-firstplace': 'tahoiya-first-place',
};

async function migrateAchievementCounters() {
	if (!db) {
		return;
	}

	// Get all unlocked tahoiya achievements
	const achievementsSnapshot = await db.collection('achievements')
		.where('name', 'in', Object.keys(achievementCounterMap))
		.get();

	console.log(`Found ${achievementsSnapshot.size} achievement records to migrate...`);

	const userCounters: Record<string, Record<string, number>> = {};

	for (const doc of achievementsSnapshot.docs) {
		const {user, name} = doc.data() as {user: string; name: string};
		const counterName = achievementCounterMap[name];
		if (!counterName || !user) {
			continue;
		}

		if (!userCounters[user]) {
			userCounters[user] = {};
		}
		// Set counter to at least 1 (don't decrease if already higher)
		userCounters[user][counterName] = Math.max(userCounters[user][counterName] ?? 0, 1);
	}

	for (const [userId, counters] of Object.entries(userCounters)) {
		const userRef = db.collection('users').doc(userId);
		const userDoc = await userRef.get();
		const existing = userDoc.exists ? userDoc.data() ?? {} : {};

		const updates: Record<string, number> = {};
		for (const [counter, value] of Object.entries(counters)) {
			const currentValue = typeof existing[counter] === 'number' ? existing[counter] : 0;
			if (currentValue < value) {
				updates[counter] = value;
			}
		}

		if (Object.keys(updates).length > 0) {
			await userRef.set(updates, {merge: true});
			console.log(`Updated counters for ${userId}:`, updates);
		}
	}

	console.log(`Achievement counter migration complete for ${Object.keys(userCounters).length} users`);
}

(async () => {
	if (!db) {
		console.error('Firestore not initialized (not in production mode)');
		process.exit(1);
	}

	await migrateSqliteThemes();
	await migrateStateRatings();
	await migrateAchievementCounters();

	console.log('Migration complete!');
	process.exit(0);
})();
