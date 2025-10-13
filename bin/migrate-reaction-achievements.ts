// Migrate reaction achievements from old format to new format
// node migrate-reaction-achievements.js

import 'dotenv/config';

import {increment, set} from '../achievements';
import {db} from '../lib/firestore';
import type {CollectionReference} from 'firebase-admin/firestore';
import type {DocumentData} from 'firebase-admin/firestore';

if (process.argv.length !== 2) {
	throw new Error('Usage: node migrate-reaction-achievements.js');
}

interface Achievement extends DocumentData {
	name: string;
	user: string;
	date: FirebaseFirestore.Timestamp;
}

const Achievements = db.collection('achievements') as CollectionReference<Achievement>;
const Users = db.collection('users');
const isDryRun = true;
let killSwitch = true;

(async () => {
	// Get all achievements whose name starts with "reaction-"
	const {docs: achievements} = await Achievements
		.where('name', '>=', 'reaction-')
		.where('name', '<', 'reaction-\u{10FFFF}')
		.get();
	for (const achievement of achievements) {
		const achievementData = achievement.data();

		console.log(`Migrate achievement ${achievement.id} (name = ${achievementData.name}, user = ${achievementData.user})...`);

		const matches = /^reaction-(?<reactionName>.+)-(?<threshold>\d+)$/.exec(achievementData.name);
		if (!matches) {
			console.error(`Failed to parse achievement name: ${achievementData.name}`);
			continue;
		}

		let reactionName = matches.groups?.reactionName;
		if (!reactionName) {
			console.error(`Failed to extract reaction name from achievement name: ${achievementData.name}`);
			continue;
		}

		if (reactionName === 'fleshpeach') {
			reactionName = 'freshpeach';
		}
		if (reactionName === 'masaka-sakasama') {
			reactionName = '108';
		}

		const threshold = parseInt(matches.groups?.threshold || '0');
		if (isNaN(threshold) || threshold <= 0) {
			console.error(`Invalid threshold in achievement name: ${achievementData.name}`);
			continue;
		}

		const counterName = `reaction-${reactionName}-${threshold}`;
		const messagesName = `reaction-${reactionName}-${threshold}-messages`;

		console.log(`\t-> Setting ${counterName} = 1 and ${messagesName} = [] for user ${achievementData.user}`);
		if (!isDryRun && !killSwitch) {
			await Users.doc(achievementData.user).update({
				[counterName]: 1,
				[messagesName]: [],
			});
		}

		if (achievementData.name !== counterName) {
			console.log(`\t-> Fixing achievement name from ${achievementData.name} to ${counterName}`);
			if (!isDryRun && !killSwitch) {
				await Achievements.doc(achievement.id).update({name: counterName});
			}
		}

		if (killSwitch && achievement.id === 'xxxxxx') {
			console.log('Kill switch deactivated.');
			killSwitch = false;
		}
	}
})();
