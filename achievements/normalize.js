const db = require('../lib/firestore.ts').default;
const countBy = require('lodash/countBy');
const groupBy = require('lodash/groupBy');
const minBy = require('lodash/minBy');
const sortBy = require('lodash/sortBy');

(async () => {
	// remove duplicated
	await db.runTransaction(async (transaction) => {
		const achievements = await transaction.get(db.collection('achievements'));
		const groupedAchievements = groupBy(achievements.docs, (achievement) => (
			[achievement.get('user'), achievement.get('name')].join('\0')
		));
		for (const [key, docs] of Object.entries(groupedAchievements)) {
			const [user, name] = key.split('\0');
			if (docs.length > 1) {
				const sortedDocs = sortBy(docs, (doc) => doc.get('date').toDate());
				for (const doc of sortedDocs.slice(1)) {
					console.log(`Deleting duplicated entry ${doc.id} (user = ${user}, name = ${name})`);
					await transaction.delete(doc.ref);
				}
			}
		}
	});

	await db.runTransaction(async (transaction) => {
		const achievements = await transaction.get(db.collection('achievements'));
		const rawAchievementData = await transaction.get(db.collection('achievement_data'));
		const achievementData = new Map(rawAchievementData.docs.map((data) => [data.get('id'), data]));

		const names = groupBy(achievements.docs, (achievement) => achievement.get('name'));
		for (const [name, nameAchievements] of Object.entries(names)) {
			const first = minBy(nameAchievements, (achievement) => achievement.get('date').seconds);
			await transaction.update(db.collection('achievement_data').doc(name), {
				count: nameAchievements.length,
				first: first.get('user'),
			});
		}

		const users = groupBy(achievements.docs, (achievement) => achievement.get('user'));
		for (const [user, userAchievements] of Object.entries(users)) {
			const categories = countBy(userAchievements, (achievement) => (
				achievementData.get(achievement.get('name')).get('category')
			));
			await transaction.update(db.collection('users').doc(user), {counts: categories});
		}
	});
})();
