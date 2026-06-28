/* eslint-env node, jest */

// @octokit/webhooks v14 はESM専用パッケージのためJest（CJS環境）では読み込めない。
// deploy/index.ts が間接的に依存しているためここでモックする。
// ファクトリ関数を渡して実際のモジュールをロードさせないようにする。
vi.mock('@octokit/webhooks', () => ({
	Webhooks: vi.fn().mockImplementation(() => ({
		verify: vi.fn().mockResolvedValue(true),
	})),
}));
vi.mock('../achievements');

const {default: Slack} = require('../lib/slackMock.ts');
const mahjong = require('./index.js');

let slack = null;

beforeEach(() => {
	slack = new Slack();
	process.env.CHANNEL_SANDBOX = slack.fakeChannel;
	mahjong(slack);
});

describe('mahjong', () => {
	it('responds to "配牌"', async () => {
		const {username} = await slack.getResponseTo('配牌');

		expect(username).toBe('mahjong');
	});
});
