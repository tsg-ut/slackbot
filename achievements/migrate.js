const db = require('../lib/firestore.ts').default;
const state = require('./state.json');

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

const batch = db.batch();

for (const [user, data] of users) {
	const doc = db.collection('users').doc(user);
	batch.set(doc, data);
}

for (const achievement of achievements) {
	const doc = db.collection('achievements').doc();
	batch.set(doc, achievement);
}

batch.commit().then(() => {
	console.log('done');
});
