/* eslint-env node, jest */

const ahokusa = require('./index.js');
const Slack = require('../lib/slackMock.js');

let slack = null;

beforeEach(() => {
	slack = new Slack();
	process.env.CHANNEL_SANDBOX = slack.fakeChannel;
	ahokusa(slack);
});

describe('ahokusa', () => {
	it('responds to あほくさスライドパズル', async () => {
		const {text, username} = await slack.getResponseTo('あほくさスライドパズル');

		expect(username).toBe('ahokusa');
		expect(text).toContain(':void:');
		expect(text).toMatch(/^(:[a-z-]+:\n?){6}$/);
	});

	it('accepts valid board initialization by emojis', async () => {
		const board = [
			':void::ahokusa-bottom-center::ahokusa-top-center:',
			':ahokusa-bottom-left::ahokusa-top-left::ahokusa-top-right:',
		].join('\n');

		const {text, username} = await slack.getResponseTo(`@ahokusa ${board}`);

		expect(username).toBe('ahokusa');
		expect(text).toBe(board);
	});

	it('accepts valid board initialization by letters', async () => {
		const {text, username} = await slack.getResponseTo('@ahokusa .#_さくあ');

		expect(username).toBe('ahokusa');
		expect(text).toBe([
			':void::ahokusa-bottom-center::ahokusa-top-center:',
			':ahokusa-bottom-left::ahokusa-top-left::ahokusa-top-right:',
		].join('\n'));
	});

	it('rejects invalid board initialization', async () => {
		const {text, username} = await slack.getResponseTo('@ahokusa ああああああ');

		expect(username).toBe('ahokusa');
		expect(text).toBe(':ha:');
	});

	it('rejects invalid board initialization', async () => {
		const {text, username} = await slack.getResponseTo('@ahokusa .#_さくああああああああああああああああああああ');

		expect(username).toBe('ahokusa');
		expect(text).toBe(':ha:');
	});

	it('responds to 寿司スライドパズル', async () => {
		const {text, username} = await slack.getResponseTo('寿司スライドパズル');

		expect(username).toBe('sushi-puzzle');
		expect(text).toContain(':void:');
		expect(text).toContain('sushi');
		expect(text).toMatch(/^(:[a-z-]+:\n?)+$/);
	});
});
