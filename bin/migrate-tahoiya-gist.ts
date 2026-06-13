import 'dotenv/config';
import axios from 'axios';
import {db} from '../lib/firestore';
import type {GameComment, GameRecord, GameRecordMeaning} from '../tahoiya/types';

const GIST_IDS = [
	'37085656670aec5093cc83360c189e7e', // 第1〜100回
	'906e53f23d5da60f32958a56ded290d9',  // 第101〜200回
	'feb7b7299f4a2080ca1685660f51d920',  // 第201〜300回
	'a98baf571a8a448699db08fd29819b8f',  // 第301〜400回
	'c6a6789aa68ec7ae274bae4a006bab0f',  // 第401〜500回
	'5b2cf04cb226c58e697fa90c3dec5937',  // 第501〜600回
	'7b13f38319ea0fe27dfcd1e6646c277b',  // 第601〜700回
	'8c29e4de4c679c27b7888ff59796f427',  // 第701〜800回
	'91c6eb909727db4086642aa10292ab8d',  // 第801〜900回
	'dddc7ab5425e5f1bef1bb37d708dd322',  // 第901〜1000回
	'eb6ae0d8c60247d4f54ab095450d2165',  // 第1001〜1100回
];

interface GistBetterEntry {
	user: string;
	coins?: number;
}

interface GistMeaning {
	text: string;
	type: 'correct' | 'user' | 'dummy';
	source?: string;
	title?: string;
	user?: string;
	betters?: GistBetterEntry[];
}

interface GistComment {
	user: string;
	text: string;
	date: string | number;
}

interface GistBattle {
	timestamp: string;
	theme: string;
	word?: string;
	meanings: GistMeaning[];
	url: string;
	comments?: GistComment[];
	author?: string | null;
	sourceString?: string;
}

interface GistData {
	offset: number;
	battles: GistBattle[];
}

const isDryRun = process.argv.includes('--dry-run');

async function fetchGistData(gistId: string): Promise<GistData> {
	const apiResponse = await axios.get<{files: Record<string, {raw_url: string}>}>(
		`https://api.github.com/gists/${gistId}`,
		{headers: {Accept: 'application/vnd.github+json'}},
	);

	const file = Object.values(apiResponse.data.files).find((f) => f.raw_url.includes('tahoiya-1-data'));
	if (!file) {
		throw new Error(`tahoiya-1-data.json not found in gist ${gistId}`);
	}

	const dataResponse = await axios.get<GistData>(file.raw_url);
	return dataResponse.data;
}

function convertBattle(battle: GistBattle): GameRecord {
	const timestamp = new Date(battle.timestamp).getTime();

	const meanings: GameRecordMeaning[] = battle.meanings.map((m) => ({
		text: m.text,
		type: m.type,
		...(m.type === 'user' && m.user ? {user: m.user} : {}),
		...(m.type === 'dummy' && m.source ? {source: m.source} : {}),
		voters: (m.betters ?? []).map((b) => ({user: b.user})),
	}));

	const participants = battle.meanings
		.filter((m) => m.type === 'user' && m.user)
		.map((m) => m.user as string)
		.filter((u, i, arr) => arr.indexOf(u) === i);

	const comments: GameComment[] = (battle.comments ?? []).map((c) => ({
		user: c.user,
		text: c.text,
		timestamp: typeof c.date === 'string' ? new Date(c.date).getTime() : c.date,
	}));

	return {
		timestamp,
		theme: battle.theme,
		word: battle.word ?? battle.theme,
		type: 'dictionary',
		sourceString: battle.sourceString ?? '',
		url: battle.url,
		meanings,
		comments,
		author: battle.author ?? null,
		participants,
	};
}

(async () => {
	if (!db) {
		console.error('Firestore is not available. Check environment variables.');
		process.exit(1);
	}

	if (isDryRun) {
		console.log('[DRY RUN] No data will be written to Firestore.');
	}

	const collection = db.collection('tahoiya_games');
	let totalConverted = 0;
	let totalSkipped = 0;

	for (const gistId of GIST_IDS) {
		console.log(`\nFetching gist ${gistId}...`);
		let data: GistData;
		try {
			data = await fetchGistData(gistId);
		} catch (err) {
			console.error(`Failed to fetch gist ${gistId}:`, err);
			continue;
		}

		console.log(`  Found ${data.battles.length} battles (offset: ${data.offset})`);

		for (const [i, battle] of data.battles.entries()) {
			const battleNumber = data.offset + i + 1;
			const record = convertBattle(battle);

			if (!isDryRun) {
				// 重複チェック: 同じタイムスタンプのドキュメントがあればスキップ
				const existing = await collection
					.where('timestamp', '==', record.timestamp)
					.limit(1)
					.get();

				if (!existing.empty) {
					console.log(`  [SKIP] 第${battleNumber}回 "${record.theme}" (already exists)`);
					totalSkipped++;
					continue;
				}

				await collection.add(record);
			}

			console.log(`  [OK] 第${battleNumber}回 "${record.theme}" (${record.participants.length} participants, ${record.comments.length} comments)`);
			totalConverted++;
		}
	}

	console.log(`\nDone. Converted: ${totalConverted}, Skipped: ${totalSkipped}`);
})();
