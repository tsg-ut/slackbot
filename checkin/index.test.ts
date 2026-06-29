import axios from 'axios';
import Slack from '../lib/slackMock';
import checkin from './index.js';

vi.mock('axios');

let slack: InstanceType<typeof Slack> = null;

beforeEach(() => {
	slack = new Slack();
	process.env.CHANNEL_SANDBOX = slack.fakeChannel;
	process.env.SWARM_TOKEN = 'fake';
	checkin(slack);
});

describe('tiobot', () => {
	it('responds to "checkin-check"', async () => {
		(axios as any).response = {
			data: {
				response: {
					hereNow: {
						items: [],
					},
				},
			},
		};

		slack.eventClient.emit('message', {
			channel: slack.fakeChannel,
			text: 'checkin-check',
			user: slack.fakeUser,
			ts: slack.fakeTimestamp,
		});

		(axios as any).response = {
			data: {
				response: {
					hereNow: {
						items: [
							{
								id: 'hogehoge',
								shout: 'おるでｗ',
								user: {
									firstName: 'Koki',
									lastName: 'Takahashi',
									photo: {
										prefix: 'http://hoge.com/',
										suffix: '/hoge.png',
									},
								},
							},
						],
					},
				},
			},
		};

		const {text, username} = await slack.getResponseTo('checkin-check');

		expect(username).toBe('checkin');
		expect(text).toContain('Koki Takahashi');
		expect(text).toContain('理学部7号館');
		expect(text).toContain('おるでｗ');
	});
});
