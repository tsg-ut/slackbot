/* eslint-env node, jest */

jest.mock('../achievements');

const sushi = require('./index.js');
const Slack = require('../lib/slackMock.js');

let slack = null;

beforeEach(() => {
	slack = new Slack();
	sushi(slack);
});

it('reacts to "おすし"', () => new Promise((resolve) => {
	slack.on('reactions.add', ({name, channel, timestamp}) => {
		expect(name).toBe('sushi');
		expect(channel).toBe(slack.fakeChannel);
		expect(timestamp).toBe(slack.fakeTimestamp);
		resolve();
	});

	slack.rtmClient.emit('message', {
		channel: slack.fakeChannel,
		text: 'おすし',
		user: slack.fakeUser,
		ts: slack.fakeTimestamp,
	});
}));

it('reacts to ":korosuzo:"', () => new Promise((resolve) => {
	const table = {no_good: false, cookies146: false};
	slack.on('reactions.add', ({name, channel, timestamp}) => {
		expect(Object.keys(table)).toContain(name); // FIXME
		expect(channel).toBe(slack.fakeChannel);
		expect(timestamp).toBe(slack.fakeTimestamp);
		table[name] = true;
		if(Object.values(table).every(x=>x)) {
			resolve();
		}
	});


	slack.rtmClient.emit('message', {
		channel: slack.fakeChannel,
		text: ':korosuzo:',
		user: slack.fakeUser,
		ts: slack.fakeTimestamp,
	});
}));

it('marks :x::four: to "sushi"x4', () => new Promise((resolve) => {
	const table = {sushi: false, x: false, four: false};
	slack.on('reactions.add', ({name, channel, timestamp}) => {
		expect(Object.keys(table)).toContain(name); // FIXME
		expect(channel).toBe(slack.fakeChannel);
		expect(timestamp).toBe(slack.fakeTimestamp);
		table[name] = true;
		if(Object.values(table).every(x=>x)) {
			resolve();
		}
	});

	slack.rtmClient.emit('message', {
		channel: slack.fakeChannel,
		text: 'sushisushisushisushi',
		user: slack.fakeUser,
		ts: slack.fakeTimestamp,
	});
}));

it('reacts to "\u3059\u0328"', () => new Promise((resolve) => {
	slack.on('reactions.add', ({name, channel, timestamp}) => {
		expect(name).toBe('sushi');
		expect(channel).toBe(slack.fakeChannel);
		expect(timestamp).toBe(slack.fakeTimestamp);
		resolve();
	});

	slack.rtmClient.emit('message', {
		channel: slack.fakeChannel,
		text: '\u3059\u0328',
		user: slack.fakeUser,
		ts: slack.fakeTimestamp,
	});
}));

it('reacts to "寿司ランキング 確認"', () => new Promise((resolve) => {
	slack.on('chat.postMessage', ({username, channel, text}) => {
		expect(username).toBe('sushi-bot');
		expect(channel).toBe("D00000000");
		expect(text).toContain('あなたのすし数は1個');
		expect(text).toContain('現在の順位は');
		resolve();
	});

	(async () => {
		const promise = new Promise(resolve => {
			slack.on('reactions.add', ({name, timestamp}) => {
				if (timestamp === slack.fakeTimestamp && name === 'sushi') {
					resolve();
				}
			});
		});

		slack.rtmClient.emit('message', {
			channel: slack.fakeChannel,
			text: 'sushi',
			user: slack.fakeUser,
			ts: slack.fakeTimestamp,
		});

		await promise;

		slack.rtmClient.emit('message', {
			channel: "D00000000",
			text: '寿司ランキング 確認',
			user: slack.fakeUser,
			ts: slack.fakeTimestamp,
		});
	})();
}));

it('reacts to "凍結ランキング 確認"', () => new Promise((resolve) => {
	slack.on('chat.postMessage', ({username, channel, text}) => {
		expect(username).toBe('sushi-bot');
		expect(channel).toBe("D00000000");
		expect(text).toContain('あなたの凍結回数は1回');
		expect(text).toContain('現在の順位は');
		resolve();
	});

	(async () => {
		const promise = new Promise(resolve => {
			const table = {no_good: false, cookies146: false};
			slack.on('reactions.add', ({name, timestamp}) => {
				if (timestamp === slack.fakeTimestamp && table.hasOwnProperty(name)) {
					table[name] = true;
				}
				if(Object.values(table).every(x=>x)) {
					resolve();
				}
			});
		});

		slack.rtmClient.emit('message', {
			channel: slack.fakeChannel,
			text: '死',
			user: slack.fakeUser,
			ts: slack.fakeTimestamp,
		});

		await promise;

		slack.rtmClient.emit('message', {
			channel: "D00000000",
			text: '凍結ランキング 確認',
			user: slack.fakeUser,
			ts: slack.fakeTimestamp,
		});
	})();
}));

