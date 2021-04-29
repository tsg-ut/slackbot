// remove achievement by user and achievement id
// node remove-achievement.js [user] [achievement id]

const db = require('../lib/firestore.ts').default;

if (process.argv.length !== 4) {
	throw new Error('Usage: node remove-achievement.js [user] [achievement id');
}

const [, , user, achievementId] = process.argv;

(async () => {
	const {docs: achievements} = await db.collection('achievements').where('name', '==', achievementId).where('user', '==', user).get();
	for (const achievement of achievements) {
		console.log(`Removing achievement ${achievement.id}...`);
		await achievement.ref.delete();
	}
})();
