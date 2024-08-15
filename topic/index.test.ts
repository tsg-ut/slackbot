/* eslint-disable callback-return */
/* eslint-disable node/callback-return */
/* eslint-disable import/imports-first */
/* eslint-disable import/first */
/* eslint-env jest */

jest.mock('../lib/state');
jest.mock('../lib/slack');
jest.mock('../lib/slackUtils', () => ({
	__esModule: true,
	getReactions: jest.fn(),
}));
jest.mock('../lib/firestore', () => ({
	__esModule: true,
	default: {
		collection: jest.fn().mockReturnValue({
			doc: jest.fn().mockReturnValue({
				get: jest.fn(),
				set: jest.fn(),
				update: jest.fn(),
			}),
		}),
		runTransaction: jest.fn(),
	},
}));

import type {firestore} from 'firebase-admin';
import {set} from 'lodash';
import db from '../lib/firestore';
import Slack from '../lib/slackMock';
import {getReactions} from '../lib/slackUtils';
import State from '../lib/state';
import {Deferred} from '../lib/utils';
import topicHandler, {addLike, removeLike} from './index';

const runTransaction = db.runTransaction as jest.MockedFunction<typeof db.runTransaction>;

const FAKE_SANDBOX = 'C123456789';

describe('topic', () => {
	describe('index.ts', () => {
		beforeEach(() => {
			jest.clearAllMocks();
		});

		describe('addLike', () => {
			it('should add a like to the message', async () => {
				const mockTransaction = {
					get: jest.fn(),
					update: jest.fn(),
				};
				const mockDoc = {
					exists: true,
					get: jest.fn().mockReturnValue([]),
				};
				runTransaction.mockImplementation(async (callback) => {
					await callback(mockTransaction as unknown as firestore.Transaction);
				});
				mockTransaction.get.mockResolvedValue(mockDoc);

				await addLike('user1', '12345');

				expect(mockTransaction.get).toBeCalledWith(db.collection('topic_messages').doc('12345'));
				expect(mockTransaction.update).toBeCalledWith(db.collection('topic_messages').doc('12345'), {likes: ['user1']});
			});

			it('should not add a like if the message does not exist', async () => {
				const mockTransaction = {
					get: jest.fn(),
					update: jest.fn(),
				};
				const mockDoc = {
					exists: false,
				};
				runTransaction.mockImplementation(async (callback) => {
					await callback(mockTransaction as unknown as firestore.Transaction);
				});
				mockTransaction.get.mockResolvedValue(mockDoc);

				await addLike('user1', '12345');

				expect(mockTransaction.get).toBeCalledWith(db.collection('topic_messages').doc('12345'));
				expect(mockTransaction.update).not.toBeCalled();
			});
		});

		describe('removeLike', () => {
			it('should remove a like from the message', async () => {
				const mockTransaction = {
					get: jest.fn(),
					update: jest.fn(),
				};
				const mockDoc = {
					exists: true,
					get: jest.fn().mockReturnValue(['user1']),
				};
				runTransaction.mockImplementation(async (callback) => {
					await callback(mockTransaction as unknown as firestore.Transaction);
				});
				mockTransaction.get.mockResolvedValue(mockDoc);

				await removeLike('user1', '12345');

				expect(mockTransaction.get).toBeCalledWith(db.collection('topic_messages').doc('12345'));
				expect(mockTransaction.update).toBeCalledWith(db.collection('topic_messages').doc('12345'), {likes: []});
			});

			it('should not remove a like if the message does not exist', async () => {
				const mockTransaction = {
					get: jest.fn(),
					update: jest.fn(),
				};
				const mockDoc = {
					exists: false,
				};
				runTransaction.mockImplementation(async (callback) => {
					await callback(mockTransaction as unknown as firestore.Transaction);
				});
				mockTransaction.get.mockResolvedValue(mockDoc);

				await removeLike('user1', '12345');

				expect(mockTransaction.get).toBeCalledWith(db.collection('topic_messages').doc('12345'));
				expect(mockTransaction.update).not.toBeCalled();
			});
		});

		describe('topicHandler', () => {
			it('should initialize state and set topic', async () => {
				const mockSlack = new Slack();

				const converastionsInfo = mockSlack.webClient.conversations.info as jest.MockedFunction<typeof mockSlack.webClient.conversations.info>;
				converastionsInfo.mockResolvedValue({
					ok: true,
					channel: {
						topic: {
							value: 'Current Topic',
						},
					},
				});

				const conversationsHistory = mockSlack.webClient.conversations.history as jest.MockedFunction<typeof mockSlack.webClient.conversations.history>;
				conversationsHistory.mockResolvedValue({
					ok: true,
					messages: [{
						ts: '12345',
						text: 'New Topic',
					}],
				});

				const setTopic = mockSlack.webClient.conversations.setTopic as jest.MockedFunction<typeof mockSlack.webClient.conversations.setTopic>;
				const setTopicDeferred = new Deferred();
				setTopic.mockImplementation(() => {
					setTopicDeferred.resolve(null);
					return Promise.resolve({ok: true});
				});

				(getReactions as jest.MockedFunction<typeof getReactions>).mockResolvedValue({
					koresuki: ['user1', 'user2', 'user3', 'user4', 'user5'],
				});

				process.env.CHANNEL_SANDBOX = FAKE_SANDBOX;

				await topicHandler(mockSlack);

				mockSlack.eventClient.emit('reaction_added', {
					item: {
						channel: FAKE_SANDBOX,
						ts: '12345',
					},
					reaction: 'koresuki',
				});

				await setTopicDeferred.promise;

				expect(mockSlack.webClient.conversations.info).toBeCalledWith({channel: process.env.CHANNEL_SANDBOX});
				expect(mockSlack.webClient.conversations.setTopic).toBeCalledWith({
					channel: process.env.CHANNEL_SANDBOX,
					topic: 'Current Topic／New Topic',
				});
			});
		});
	});
});
