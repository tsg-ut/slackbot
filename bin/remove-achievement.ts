// remove achievement by user and achievement id
// NODE_ENV=production npx tsx bin/remove-achievement.ts [user] [achievement id]

import 'dotenv/config';

import db from '../lib/firestore.js';

if (process.argv.length !== 4) {
	throw new Error('Usage: npx tsx bin/remove-achievement.ts [user] [achievement id]');
}

const [, , user, achievementId] = process.argv;

const {docs: achievements} = await db.collection('achievements').where('name', '==', achievementId).where('user', '==', user).get();
for (const achievement of achievements) {
	console.log(`Removing achievement ${achievement.id}...`);
	await achievement.ref.delete();
}
