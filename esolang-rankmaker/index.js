const {RTM_EVENTS: {MESSAGE}} = require('@slack/client');
const {sum} = require('lodash');

module.exports = (clients) => {
	const {rtmClient: rtm, webClient: slack} = clients;

	rtm.on(MESSAGE, async (message) => {
		if (message.channel !== process.env.CHANNEL_ESOLANG) {
			return;
		}

		if (message.subtype === 'bot_message') {
			return;
		}

		if (!message.text) {
			return;
		}

		const text = message.text.trim();

		if (text !== '集計') {
			return;
		}

		const {members} = await slack.users.list();
		const membersMap = new Map(members.map((member) => [member.id, member]));

		const getHistory = process.env.CHANNEL_ESOLANG.startsWith('D')
			? slack.im.history.bind(slack.im)
			: slack.channels.history.bind(slack.channels);
		const data = await getHistory(process.env.CHANNEL_ESOLANG, {count: 1000});

		const ranking = new Map();

		const now = Date.now();
		const boundary = now - 30 * 60 * 1000; // 30 mins before

		for (const logMessage of data.messages.reverse()) {
			const ts = parseFloat(logMessage.ts) * 1000;
			if (ts > boundary && logMessage.text.includes('+') && logMessage.username !== 'esolang-ranking') {
				const points = logMessage.text.replace(/[=].*$/, '').split('+').map((token) => parseInt(token.trim()));
				const user = membersMap.get(logMessage.user);
				ranking.set(logMessage.username || user.name, points);
			}
		}

		if (ranking.size === 0) {
			await slack.chat.postMessage(message.channel, 'No record available', {
				username: 'esolang-ranking',
				// eslint-disable-next-line camelcase
				icon_emoji: ':scream:',
			});
			return;
		}

		// eslint-disable-next-line no-unused-vars
		const sortedRanking = Array.from(ranking).sort(([nameA, pointsA], [nameB, pointsB]) => {
			const solvedA = pointsA.filter((point) => !Number.isNaN(point));
			const solvedB = pointsB.filter((point) => !Number.isNaN(point));

			if (solvedA.length !== solvedB.length) {
				return solvedB.length - solvedA.length;
			}

			return sum(solvedA) - sum(solvedB);
		});

		const rankingText = sortedRanking.map(([name, points], index) => (
			`#${index + 1} @${name}: ${points.map((point) => Number.isNaN(point) ? '*' : point).join(' + ')} = ${sum(points.filter((point) => !Number.isNaN(point)))}`
		)).join('\n');

		await slack.chat.postMessage(message.channel, rankingText, {
			username: 'esolang-ranking',
			// eslint-disable-next-line camelcase
			icon_emoji: ':triangular_flag_on_post:',
		});
	});
};
