import FakeTimers from '@sinonjs/fake-timers';
import type {InstalledClock} from '@sinonjs/fake-timers';
import {expect, it, beforeEach, afterEach, describe, vi} from 'vitest';
import Slack from '../lib/slackMock';
import sunrise from './index';

vi.mock('cloudinary');
vi.mock('node-persist');
vi.mock('./render');
vi.mock('./fetch');
vi.mock('../lib/slackUtils');
vi.mock('../lib/state');
vi.mock('../lib/openai', () => ({
	__esModule: true,
	default: {
		chat: {
			completions: {
				create: vi.fn(),
			},
		},
	},
}));

let slack: Slack = null;
let clock: InstalledClock = null;

describe('sunrise', () => {
	beforeEach(async () => {
		slack = new Slack();
		clock = FakeTimers.install();
		process.env.CHANNEL_SANDBOX = slack.fakeChannel;
		await sunrise(slack);
	});

	afterEach(() => {
		if (clock !== null) {
			clock.uninstall();
		}
	});

	it('notify sunrise on sunrise', () => new Promise<void>((resolve) => {
		clock.setSystemTime(new Date('2019-03-21T06:00:00+0900'));

		slack.on('chat.postMessage', ({text}: {text: string}) => {
			if (!text.includes('wave')) {
				expect(text).toContain('ahokusa');
				resolve();
			}
		});
		clock.tick(15 * 1000);
	}));

	it('notify sunset on sunset', () => new Promise<void>((resolve) => {
		clock.setSystemTime(new Date('2019-03-21T19:00:00+0900'));

		slack.on('chat.postMessage', ({text}: {text: string}) => {
			if (!text.includes('ahokusa')) {
				expect(text).toContain('wave');
				resolve();
			}
		});
		clock.tick(15 * 1000);
	}));
});
