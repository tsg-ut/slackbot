const db = require('../lib/firestore.ts').default;
const chunk = require('lodash/chunk');

(async () => {
	const achievements = await db.collection('achievements').get();
	for (const achievementChunks of chunk(Array.from(achievements.docs), 300)) {
		const batch = db.batch();
		for (const doc of achievementChunks) {
			batch.set(doc.ref, {
				name: doc.get('id') || doc.get('name'),
				user: doc.get('user'),
				date: doc.get('date'),
			});
		}
		await batch.commit();
	}
})();
