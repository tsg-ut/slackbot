/* eslint-disable import/imports-first */
/* eslint-disable import/first */
/* eslint-env jest */

jest.mock('../lib/state');
jest.mock('../lib/slack');
jest.mock('../lib/slackUtils');
jest.mock('node-schedule', () => ({
	scheduleJob: jest.fn(),
}));

import schedule, {Job} from 'node-schedule';
import Slack from '../lib/slackMock';
import {Deferred} from '../lib/utils';
import autoArchiver from './index';

describe('auto-archiver', () => {
	it('should schedule job', async () => {
		const scheduleMock = schedule as jest.Mocked<typeof schedule>;
		const deferred = new Deferred();
		const triggerDate = new Date();

		scheduleMock.scheduleJob.mockImplementation((rule, fn) => {
			expect(rule).toBe('0 9 * * *');

			const callbackPromise = fn(triggerDate);
			expect(callbackPromise).not.toBeUndefined();
			if (callbackPromise) {
				callbackPromise.then(() => {
					deferred.resolve(null);
				});
			}

			return {} as Job;
		});

		const slack = new Slack();
		await autoArchiver(slack);

		expect(scheduleMock.scheduleJob).toBeCalled();

		await deferred.promise;
	});
});
