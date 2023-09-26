/* eslint-env node, jest */
jest.mock('../achievements');
jest.mock('moment');
jest.mock('../lib/state');
jest.mock('fs-extra', () => ({
	mkdirp: jest.fn(),
	readFile: jest.fn(() => Promise.resolve(Buffer.from(''))),
	writeFile: jest.fn(),
	pathExists: jest.fn(() => Promise.resolve(false)),
}));

const moment = require('moment');
const {default: sushi} = require('./index.ts');
const Slack = require('../lib/slackMock.js');

let slack = null;

beforeEach(async () => {
	slack = new Slack();
	await sushi(slack);

	moment.mockImplementation(() => ({
		utcOffset: () => ({
			day: () => 1,
		})
	}));
});

it('reacts to "おすし"', () => new Promise((resolve) => {
	slack.on('reactions.add', ({name, channel, timestamp}) => {
		expect(name).toBe('sushi');
		expect(channel).toBe(slack.fakeChannel);
		expect(timestamp).toBe(slack.fakeTimestamp);
		resolve();
	});

	slack.eventClient.emit('message', {
		channel: slack.fakeChannel,
		text: 'おすし',
		user: slack.fakeUser,
		ts: slack.fakeTimestamp,
	});
}));

it('reacts to ":korosuzo:"', () => new Promise((resolve) => {
	const table = {no_good: false, shaved_ice: false};
	slack.on('reactions.add', ({name, channel, timestamp}) => {
		expect(Object.keys(table)).toContain(name); // FIXME
		expect(channel).toBe(slack.fakeChannel);
		expect(timestamp).toBe(slack.fakeTimestamp);
		table[name] = true;
		if(Object.values(table).every(x=>x)) {
			resolve();
		}
	});


	slack.eventClient.emit('message', {
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

	slack.eventClient.emit('message', {
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

	slack.eventClient.emit('message', {
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

		slack.eventClient.emit('message', {
			channel: slack.fakeChannel,
			text: 'sushi',
			user: slack.fakeUser,
			ts: slack.fakeTimestamp,
		});

		await promise;

		slack.eventClient.emit('message', {
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
			const table = {no_good: false, shaved_ice: false};
			slack.on('reactions.add', ({name, timestamp}) => {
				if (timestamp === slack.fakeTimestamp && table.hasOwnProperty(name)) {
					table[name] = true;
				}
				if(Object.values(table).every(x=>x)) {
					resolve();
				}
			});
		});

		slack.eventClient.emit('message', {
			channel: slack.fakeChannel,
			text: '死',
			user: slack.fakeUser,
			ts: slack.fakeTimestamp,
		});

		await promise;

		slack.eventClient.emit('message', {
			channel: "D00000000",
			text: '凍結ランキング 確認',
			user: slack.fakeUser,
			ts: slack.fakeTimestamp,
		});
	})();
}));

it('reacts to "あさ！" with :100: at 8:59:59', () => new Promise((resolve) => {
	moment.mockImplementation(() => ({
		utcOffset: () => ({
			hour: () => 8,
			minutes: () => 59,
			seconds: () => 59,
		})
	}));

	slack.on('reactions.add', ({name, channel, timestamp}) => {
		expect(name).toBe('100');
		expect(channel).toBe(slack.fakeChannel);
		expect(timestamp).toBe(slack.fakeTimestamp);
		resolve();
	});

	slack.eventClient.emit('message', {
		channel: slack.fakeChannel,
		text: 'あさ！',
		user: slack.fakeUser,
		ts: slack.fakeTimestamp,
	});
}));

it('reacts to "あさ！" with :95: at 9:00:01', () => new Promise((resolve) => {
	moment.mockImplementation(() => ({
		utcOffset: () => ({
			hour: () => 9,
			minutes: () => 0,
			seconds: () => 1,
		})
	}));

	slack.on('reactions.add', ({name, channel, timestamp}) => {
		expect(name).toBe('95');
		expect(channel).toBe(slack.fakeChannel);
		expect(timestamp).toBe(slack.fakeTimestamp);
		resolve();
	});

	slack.eventClient.emit('message', {
		channel: slack.fakeChannel,
		text: 'あさ！',
		user: slack.fakeUser,
		ts: slack.fakeTimestamp,
	});
}));

it('reacts to "起床ランキング 確認', () => new Promise((resolve) => {
	moment.mockImplementation(() => ({
		utcOffset: () => ({
			hour: () => 10,
			minutes: () => 0,
			seconds: () => 0,
		})
	}));
	slack.on('chat.postMessage', ({username, channel, text}) => {
		expect(username).toBe('sushi-bot');
		expect(channel).toBe("D00000000");
		expect(text).toContain('あなたの起床点数は80点');
		expect(text).toContain('現在の順位は');
		resolve();
	});


	(async () => {
		const promise = new Promise(resolve => {
			slack.on('reactions.add', ({name, timestamp}) => {
				if (timestamp === slack.fakeTimestamp && name === '80') {
					resolve();
				}
			});
		});

		slack.eventClient.emit('message', {
			channel: slack.fakeChannel,
			text: 'あさ',
			user: slack.fakeUser,
			ts: slack.fakeTimestamp,
		});

		await promise;

		slack.eventClient.emit('message', {
			channel: "D00000000",
			text: '起床ランキング 確認',
			user: slack.fakeUser,
			ts: slack.fakeTimestamp,
		});
	})();
}));

it('reacts to "エクササイズランキング 確認"', () => new Promise((resolve) => {
	slack.on('chat.postMessage', ({username, channel, text}) => {
		expect(username).toBe('sushi-bot');
		expect(channel).toBe("D00000000");
		expect(text).toContain('あなたのエクササイズ日数は1日');
		expect(text).toContain('現在の順位は');
		resolve();
	});

	(async () => {
		const promise = new Promise(resolve => {
			const table = {sugoi: false, erai: false};
			slack.on('reactions.add', ({name, timestamp}) => {
				if (timestamp === slack.fakeTimestamp && table.hasOwnProperty(name)) {
					table[name] = true;
				}
				if(Object.values(table).every(x=>x)) {
					resolve();
				}
			});
		});

		slack.eventClient.emit('message', {
			channel: slack.fakeChannel,
			text: ':exercise-done:',
			user: slack.fakeUser,
			ts: slack.fakeTimestamp,
		});

		await promise;

		slack.eventClient.emit('message', {
			channel: "D00000000",
			text: 'エクササイズランキング 確認',
			user: slack.fakeUser,
			ts: slack.fakeTimestamp,
		});
	})();
}));

it('reacts to "twitter" with :x-logo:', () => new Promise((resolve) => {
	slack.on('reactions.add', ({name, channel, timestamp}) => {
		expect(name).toBe('x-logo');
		expect(channel).toBe(slack.fakeChannel);
		expect(timestamp).toBe(slack.fakeTimestamp);
		resolve();
	});

	slack.eventClient.emit('message', {
		channel: slack.fakeChannel,
		text: '私のtwitterアカウントは@hakatashiです',
		user: slack.fakeUser,
		ts: slack.fakeTimestamp,
	});
}));

it('reacts to "twitter" with :x-logo: case-insensitively', () => new Promise((resolve) => {
	slack.on('reactions.add', ({name, channel, timestamp}) => {
		expect(name).toBe('x-logo');
		expect(channel).toBe(slack.fakeChannel);
		expect(timestamp).toBe(slack.fakeTimestamp);
		resolve();
	});

	slack.eventClient.emit('message', {
		channel: slack.fakeChannel,
		text: '私のTwIttERアカウントは@hakatashiです',
		user: slack.fakeUser,
		ts: slack.fakeTimestamp,
	});
}));

it('does not react to "twitter.com"', async () => {
	slack.webClient.reactions.add.mockReturnValue(null);

	slack.eventClient.emit('message', {
		channel: slack.fakeChannel,
		text: '<https://twitter.com/hakatashi/status/1539187440476246017>',
		user: slack.fakeUser,
		ts: slack.fakeTimestamp,
	});

	await new Promise((resolve) => process.nextTick(resolve));

	expect(slack.webClient.reactions.add).not.toHaveBeenCalled();
});

it('reacts to sushi in an attachment', async () => {
	slack.on('reactions.add', ({ name, channel, timestamp }) => {
		expect(name).toBe('sushi');
		expect(channel).toBe(slack.fakeChannel);
		expect(timestamp).toBe(slack.fakeTimestamp);
		resolve();
	});

	slack.eventClient.emit('message', {
		channel: slack.fakeChannel,
		text: '',
		user: slack.fakeUser,
		ts: slack.fakeTimestamp,
		attachments: [{
			text: 'sushi',
		}],
	});
});

it('reacts to sushi in an attachment (dynamically added)', async () => {
	slack.on('reactions.add', ({ name, channel, timestamp }) => {
		expect(name).toBe('sushi');
		expect(channel).toBe(slack.fakeChannel);
		expect(timestamp).toBe(slack.fakeTimestamp);
		resolve();
	});

	slack.eventClient.emit('message', {
		channel: slack.fakeChannel,
		text: '',
		user: slack.fakeUser,
		ts: slack.fakeTimestamp,
		attachments: [],
	});
	slack.eventClient.emit('message', {
		subtype: 'message_changed',
		message: {
			text: '',
			user: slack.fakeUser,
			attachments: [{
				text: 'sushi'
			}],
			ts: slack.fakeTimestamp,
		},
		channel: slack.fakeChannel,
	});
});
