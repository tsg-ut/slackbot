
import firebaseFunctionsTest from 'firebase-functions-test';

process.env.SLACK_TOKEN = 'xoxb-slacktoken';
process.env.AWS_ACCESS_KEY_ID = 'ACCESS-KEY-ID';
process.env.AWS_SECRET_ACCESS_KEY = 'SECRET-ACCESS-KEY';

const test = firebaseFunctionsTest();

const filesListMock = vi.fn();

vi.mock('axios');
vi.mock('@slack/web-api', () => ({
	WebClient: vi.fn().mockImplementation(() => ({
		files: {
			list: filesListMock,
		},
	}))
}));
vi.mock('aws-sdk');

import {DynamoDB} from 'aws-sdk';

import {slackFileArchiveCronJob} from './slackFileArchiveCronJob';

const cronJob = test.wrap(slackFileArchiveCronJob);

const CURRENT_TIME = 1700000000;

vi.useFakeTimers();
vi.spyOn(global, 'setTimeout');

describe('slackFileArchiveCronJob', () => {
	it('works', async () => {
		vi.setSystemTime(CURRENT_TIME * 1000);

		filesListMock.mockResolvedValue({
			files: [{
				id: 'file1',
				url_private_download: 'https://hoge.com',
			}],
		});

		const batchGetMock = jest
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

		const batchWriteMock = jest
			.spyOn(DynamoDB.DocumentClient.prototype, 'batchWrite')
			// @ts-ignore
			.mockImplementation(() => ({
				promise: vi.fn(),
			}));

		const cronJobPromise = cronJob(undefined);

		expect(setTimeout).toHaveBeenCalledTimes(1);
		expect(setTimeout).toHaveBeenLastCalledWith(expect.any(Function), 1000);

		vi.runAllTimers();
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