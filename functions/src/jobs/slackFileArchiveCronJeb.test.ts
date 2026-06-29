
import firebaseFunctionsTest from 'firebase-functions-test';

process.env.SLACK_TOKEN = 'xoxb-slacktoken';
process.env.AWS_ACCESS_KEY_ID = 'ACCESS-KEY-ID';
process.env.AWS_SECRET_ACCESS_KEY = 'SECRET-ACCESS-KEY';

const test = firebaseFunctionsTest();

const filesListMock = vi.hoisted(() => vi.fn());

vi.mock('axios');
vi.mock('@slack/web-api', () => ({
	WebClient: vi.fn(function(this: any) {
		this.files = {
			list: filesListMock,
		};
	}),
}));
vi.mock('aws-sdk', () => {
	class DocumentClient {
		// eslint-disable-next-line @typescript-eslint/no-unused-vars
		batchGet(_params: unknown) { return {promise: vi.fn()}; }
		// eslint-disable-next-line @typescript-eslint/no-unused-vars
		batchWrite(_params: unknown) { return {promise: vi.fn()}; }
	}
	class S3 {
		// eslint-disable-next-line @typescript-eslint/no-unused-vars
		putObject(_params: unknown) { return {promise: vi.fn()}; }
	}
	return {DynamoDB: {DocumentClient}, S3};
});

import {DynamoDB} from 'aws-sdk';

import {slackFileArchiveCronJob} from './slackFileArchiveCronJob';

const cronJob = test.wrap(slackFileArchiveCronJob);

const CURRENT_TIME = 1700000000;

describe('slackFileArchiveCronJob', () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	it('works', async () => {
		vi.useFakeTimers();
		vi.setSystemTime(CURRENT_TIME * 1000);

		filesListMock
			.mockResolvedValueOnce({
				files: [{
					id: 'file1',
					url_private_download: 'https://hoge.com',
				}],
			})
			.mockResolvedValue({files: []});

		const batchGetMock = vi
			.spyOn(DynamoDB.DocumentClient.prototype, 'batchGet')
			// @ts-ignore
			.mockImplementation(() => ({
				promise: vi.fn().mockResolvedValue({
					Responses: {
						'slack-files': [{
							id: 'file1',
						}],
					},
				}),
			}));

		const batchWriteMock = vi
			.spyOn(DynamoDB.DocumentClient.prototype, 'batchWrite')
			// @ts-ignore
			.mockImplementation(() => ({
				promise: vi.fn(),
			}));

		const cronJobPromise = cronJob(undefined);

		await vi.runAllTimersAsync();
		await cronJobPromise;

		expect(filesListMock).toHaveBeenCalledWith({
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