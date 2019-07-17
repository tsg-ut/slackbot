const db = require('../lib/firestore.ts').default;
const countBy = require('lodash/countBy');
const groupBy = require('lodash/groupBy');
const minBy = require('lodash/minBy');

db.runTransaction(async (transaction) => {
	const achievements = await transaction.get(db.collection('achievements'));
	const rawAchievementData = await transaction.get(db.collection('achievement_data'));
	const achievementData = new Map(rawAchievementData.docs.map((data) => [data.get('id'), data]));

	const names = groupBy(achievements.docs, (achievement) => achievement.get('name'));
	for (const [name, nameAchievements] of Object.entries(names)) {
		const first = minBy(nameAchievements, (achievement) => achievement.get('date'));
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
