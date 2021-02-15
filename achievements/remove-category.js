// remove achievements by category
// node remove-category.js [category]

const db = require('../lib/firestore.ts').default;

if (process.argv.length !== 3) {
	throw new Error('Usage: node remove-category.js [category]');
}

const category = process.argv[2];

(async () => {
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
})();
