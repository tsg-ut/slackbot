import {slackFileArchiveCronJob} from './slackFileArchiveCronJob';
import firebaseFunctionsTest from 'firebase-functions-test';
import {vi} from 'vitest';

process.env.SLACK_TOKEN = 'xoxb-slacktoken';
process.env.AWS_ACCESS_KEY_ID = 'ACCESS-KEY-ID';
process.env.AWS_SECRET_ACCESS_KEY = 'SECRET-ACCESS-KEY';

const test = firebaseFunctionsTest();

const filesList = vi.hoisted(() => vi.fn());
const batchGet = vi.hoisted(() => vi.fn());
const batchWrite = vi.hoisted(() => vi.fn());

vi.mock('axios');
vi.mock('@slack/web-api', () => ({
	WebClient: class {
		files = {
			list: filesList,
		};
	},
}));
vi.mock('aws-sdk', () => ({
	DynamoDB: {
		DocumentClient: class {
			batchGet = batchGet;
			batchWrite = batchWrite;
		},
	},
	S3: class {},
}));

const cronJob = test.wrap(slackFileArchiveCronJob);

const CURRENT_TIME = 1700000000;

describe('slackFileArchiveCronJob', () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	it('works', async () => {
		vi.useFakeTimers();
		vi.setSystemTime(CURRENT_TIME * 1000);

		filesList
			.mockResolvedValueOnce({
				files: [{
					id: 'file1',
					url_private_download: 'https://hoge.com',
				}],
			})
			.mockResolvedValue({files: []});

		const batchGetMock = batchGet.mockReturnValue({
			promise: vi.fn().mockResolvedValue({
				Responses: {
					'slack-files': [{
						id: 'file1',
					}],
				},
			}),
		});

		const batchWriteMock = batchWrite.mockReturnValue({
			promise: vi.fn(),
		});

		const cronJobPromise = cronJob(undefined);

		await vi.runAllTimersAsync();
		await cronJobPromise;

		expect(filesList).toHaveBeenCalledWith({
			count: 100,
			page: 1,
			ts_to: CURRENT_TIME.toString(),
		});

		expect(batchGetMock).toHaveBeenCalledWith({
			RequestItems: {
				'slack-files': {
					Keys: [{
						id: 'file1',
					}],
				},
			},
		});

		expect(batchWriteMock).toHaveBeenCalledWith({
			RequestItems: {
				'slack-files': [{
					PutRequest: {
						Item: {
							id: 'file1',
							url_private_download: 'https://hoge.com',
						},
					},
				}],
			},
		});
	});
});