// remove achievements by category
// NODE_ENV=production npx tsx bin/remove-category.ts [category]

import 'dotenv/config';

import db from '../lib/firestore.js';

if (process.argv.length !== 3) {
	throw new Error('Usage: npx tsx bin/remove-category.ts [category]');
}

const category = process.argv[2];

const {docs: achievementData} = await db.collection('achievement_data').where('category', '==', category).get();
for (const datum of achievementData) {
	console.log(`Removing ${datum.id}...`);
	const {docs: achievements} = await db.collection('achievements').where('name', '==', datum.id).get();
	for (const achievement of achievements) {
		console.log(`Removing achievement ${achievement.id}...`);
		await achievement.ref.delete();
	}
	console.log(`Removing achievement_datum ${datum.id}...`);
	await datum.ref.delete();
}
