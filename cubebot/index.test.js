/* eslint-env node, jest */

const cubebot = require('./index.js');
const Slack = require('../lib/slackMock.js');

let slack = null;

beforeEach(() => {
	slack = new Slack();
	process.env.CHANNEL_SANDBOX = slack.fakeChannel;
	cubebot(slack);
});

describe('スクランブル', () => {
	it('generates one scramble by "スクランブル"', async () => {
		const {text, username, attachments} = await slack.getResponseTo(
			'スクランブル'
		);

		expect(username).toBe('cubebot');
		expect(text).toBe('');
		expect(attachments).toHaveLength(1);
		expect(attachments[0]).toHaveProperty('title');
		expect(attachments[0]).toHaveProperty('title_link');
		expect(attachments[0]).toHaveProperty('image_url');
	});

	it('generates five scrambles by "スクランブル5つ"', async () => {
		const {attachments} = await slack.getResponseTo('スクランブル5つ');

		expect(attachments).toHaveLength(5);
	});

	it('generates twelve scrambles by "スクランブル100つ"', async () => {
		const {attachments} = await slack.getResponseTo('スクランブル100つ');

		expect(attachments).toHaveLength(12);
	});

	for (const token of ['F2L', 'PLL', 'LL', 'ZBLL', 'CMLL', 'L6E']) {
		it(`responds to "${token}5つ"`, async () => {
			const {attachments} = await slack.getResponseTo(`${token}5つ`);

			expect(attachments).toHaveLength(5);
		});
	}
});

describe('クロス', () => {
	it('generates crosses', async () => {
		await slack.getResponseTo('スクランブル');
		const {username, text, attachments} = await slack.getResponseTo(
			'クロス'
		);

		expect(username).toBe('cubebot');
		expect(text).toBe('');
		expect(attachments).toHaveLength(7);
	});
});

describe('record', () => {
	it('generates record', async () => {
		const {username, text} = await slack.getResponseTo('1 2 3 4 5');

		expect(username).toBe('cubebot');
		expect(text).toBe('*3.00*: (1.00) 2.00 3.00 4.00 (5.00)');
	});

	it('generates record from DNF', async () => {
		const {username, text} = await slack.getResponseTo(
			'5.0 DNF 4.0 3.0 2.0'
		);

		expect(username).toBe('cubebot');
		expect(text).toBe('*4.00*: 5.00 (DNF) 4.00 3.00 (2.00)');
	});
});
