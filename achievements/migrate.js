const db = require('../lib/firestore.ts').default;
const state = require('./state.json');
const chunk = require('lodash/chunk');

const users = new Map();

for (const [user, value] of Object.entries(state.counters.chats)) {
	if (!users.has(user)) {
		users.set(user, {});
	}
	users.get(user).chats = value;
}
for (const [user, value] of Object.entries(state.counters.chatDays)) {
	if (!users.has(user)) {
		users.set(user, {});
	}
	users.get(user).chatDays = value;
}
for (const [user, value] of Object.entries(state.variables.lastChatDay)) {
	if (!users.has(user)) {
		users.set(user, {});
	}
	users.get(user).lastChatDay = value;
}
const achievements = [];
for (const [user, userAchievements] of Object.entries(state.achievements)) {
	for (const achievement of userAchievements) {
		achievements.push({
			user,
			id: achievement.id,
			date: new Date(achievement.date),
		});
	}
}

(async () => {
	for (const userChunks of chunk(Array.from(users), 300)) {
		const batch = db.batch();
		for (const [user, data] of userChunks) {
			const doc = db.collection('users').doc(user);
			batch.set(doc, data);
		}
		await batch.commit();
	}

	for (const achievementChunks of chunk(Array.from(achievements), 300)) {
		const batch = db.batch();
		for (const achievement of achievementChunks) {
			const doc = db.collection('achievements').doc();
			batch.set(doc, achievement);
		}
		await batch.commit();
	}
})();
