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

it('reacts to :korosuzo:', () => new Promise((resolve) => {
	slack.on('reactions.add', ({name, channel, timestamp}) => {
		expect(name).toBe('no_good');
		expect(name).toBe('cookies146');
		expect(channel).toBe(slack.fakeChannel);
		expect(timestamp).toBe(slack.fakeTimestamp);
		resolve();
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