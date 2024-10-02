jest.mock('./image', () => ({
	upload: jest.fn(),
}));
jest.mock('./rust-proxy');
jest.mock('../achievements');
jest.mock('../lib/slackUtils');

import * as image from './image';
import * as rust_proxy from './rust-proxy';

import SinglePlayRicochetRobot from './SinglePlayRicochetRobot';
import Slack from '../lib/slackMock';

import fs from 'fs/promises';
import path from 'path';
import type { UploadApiResponse } from 'cloudinary';

const FAKE_TIMESTAMP_1 = '1234567890.123456';
const FAKE_TIMESTAMP_2 = '1234567890.123457';
const FAKE_TIMESTAMP_3 = '1234567890.123458';

const get_data = rust_proxy.get_data as jest.MockedFunction<typeof rust_proxy.get_data>;
get_data.mockResolvedValue(fs.readFile(path.join(__dirname, 'rust_test_output.txt'), 'utf-8'));

const uploadMock = image.upload as jest.MockedFunction<typeof image.upload>;
uploadMock.mockResolvedValue({
	secure_url: 'https://hoge.com/hoge.png',
	public_id: 'hoge',
} as UploadApiResponse);

describe('hyperrobot', () => {
	let slack: Slack | null = null;

	beforeEach(async () => {
		slack = new Slack();
		process.env.CHANNEL_SANDBOX = slack.fakeChannel;
	});

	describe('SinglePlayRicochetRobot', () => {
		it('responds to ハイパーロボット', async () => {
			const postMessage = slack.webClient.chat.postMessage as jest.MockedFunction<typeof slack.webClient.chat.postMessage>;
			const mockedPostMessage = postMessage.mockResolvedValueOnce({
				ok: true,
				ts: FAKE_TIMESTAMP_2,
				message: {
					thread_ts: FAKE_TIMESTAMP_1,
				},
			});

			const singlePlayRicochetRobot = await SinglePlayRicochetRobot.init({
				slackClients: slack,
				channel: slack.fakeChannel,
				depth: 10,
				size: {h: 16, w: 16},
				numOfWalls: 30,
				threadTs: FAKE_TIMESTAMP_1,
				originalUser: slack.fakeUser,
			});

			singlePlayRicochetRobot.start();

			expect(mockedPostMessage).toBeCalledTimes(1);

			const firstMessage = mockedPostMessage.mock.calls[0][0];
			const blocks = 'blocks' in firstMessage ? firstMessage.blocks : [];
			expect('username' in firstMessage && firstMessage.username).toBe('hyperrobot');
			expect(firstMessage.text).toContain('10手詰めです');
			expect(firstMessage.channel).toBe(slack.fakeChannel);
			expect(blocks).toHaveLength(1);

			mockedPostMessage.mockResolvedValueOnce({
				ok: true,
				ts: FAKE_TIMESTAMP_3,
				message: {
					thread_ts: FAKE_TIMESTAMP_1,
				},
			});

			slack.postMessage('赤右', {
				thread_ts: FAKE_TIMESTAMP_1,
			});

			expect(mockedPostMessage).toBeCalledTimes(2);
			const secondMessage = mockedPostMessage.mock.calls[1][0];
			expect('username' in secondMessage && secondMessage.username).toBe('hyperrobot');
			expect(secondMessage.text).toContain('解けてませんね');
		});
	});
});
