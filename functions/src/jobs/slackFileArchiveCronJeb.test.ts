
import firebaseFunctionsTest from 'firebase-functions-test';

// Set environment variables for the test
process.env.SLACK_TOKEN = 'xoxb-slacktoken';
process.env.AWS_SECRET_ACCESS_KEY = 'SECRET-ACCESS-KEY';
process.env.AWS_ACCESS_KEY_ID = 'ACCESS-KEY-ID';

const test = firebaseFunctionsTest();

const filesListMock = jest.fn();

jest.mock('axios');
jest.mock('@slack/web-api', () => ({
	WebClient: jest.fn().mockImplementation(() => ({
		files: {
			list: filesListMock,
		},
	}))
}));
jest.mock('aws-sdk');

import {DynamoDB} from 'aws-sdk';

import {slackFileArchiveCronJob} from './slackFileArchiveCronJob';

const cronJob = test.wrap(slackFileArchiveCronJob);

const CURRENT_TIME = 1700000000;

jest.useFakeTimers();
jest.spyOn(global, 'setTimeout');

describe('slackFileArchiveCronJob', () => {
	it('works', async () => {
		jest.setSystemTime(CURRENT_TIME * 1000);

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
				promise: jest.fn().mockResolvedValue({
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
				promise: jest.fn(),
			}));

		const cronJobPromise = cronJob(undefined);

		expect(setTimeout).toHaveBeenCalledTimes(1);
		expect(setTimeout).toHaveBeenLastCalledWith(expect.any(Function), 1000);

		jest.runAllTimers();
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