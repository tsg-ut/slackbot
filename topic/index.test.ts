/* eslint-disable callback-return */
/* eslint-disable node/callback-return */
/* eslint-disable import/imports-first */
/* eslint-disable import/first */

vi.mock('../achievements');
vi.mock('../lib/state');
vi.mock('../lib/slack');
vi.mock('../lib/slackUtils', () => ({
	__esModule: true,
	getReactions: vi.fn(),
}));
vi.mock('../lib/slackPatron', () => ({
	__esModule: true,
	conversationsHistory: vi.fn(),
	conversationsReplies: vi.fn(),
}));
vi.mock('../lib/firestore', () => ({
	__esModule: true,
	default: {
		collection: vi.fn().mockReturnValue({
			doc: vi.fn().mockReturnValue({
				get: vi.fn(),
				set: vi.fn(),
				update: vi.fn(),
			}),
		}),
		runTransaction: vi.fn(),
	},
}));

import type {firestore} from 'firebase-admin';
import db from '../lib/firestore';
import {conversationsHistory} from '../lib/slackPatron';
import Slack from '../lib/slackMock';
import {getReactions} from '../lib/slackUtils';
import topicHandler, {addLike, removeLike} from './index';

const runTransaction = db.runTransaction as vi.MockedFunction<typeof db.runTransaction>;

const FAKE_SANDBOX = 'C123456789';

describe('topic', () => {
	describe('index.ts', () => {
		beforeEach(() => {
			vi.clearAllMocks();
		});

		describe('addLike', () => {
			it('should add a like to the message', async () => {
				const mockTransaction = {
					get: vi.fn(),
					update: vi.fn(),
				};
				const mockDoc = {
					exists: true,
					get: vi.fn().mockReturnValue([]),
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
					get: vi.fn(),
					update: vi.fn(),
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
					get: vi.fn(),
					update: vi.fn(),
				};
				const mockDoc = {
					exists: true,
					get: vi.fn().mockReturnValue(['user1']),
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
					get: vi.fn(),
					update: vi.fn(),
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
			const setupTest = async (
				mockSlack: Slack,
				currentTopic: string,
				message: string,
				reaction: string,
				reactions: Record<string, string[]>,
				messageUser?: string,
			) => {
				const MESSAGE_TS = '12345';

				const converastionsInfo = mockSlack.webClient.conversations.info as vi.MockedFunction<typeof mockSlack.webClient.conversations.info>;
				converastionsInfo.mockResolvedValue({
					ok: true,
					channel: {
						topic: {
							value: currentTopic,
						},
					},
				});

				const mockConversationsHistory = conversationsHistory as vi.MockedFunction<typeof conversationsHistory>;
				mockConversationsHistory.mockResolvedValue({
					ok: true,
					messages: [{
						ts: MESSAGE_TS,
						text: message,
						user: messageUser,
					}],
				});

				const setTopic = mockSlack.webClient.conversations.setTopic as vi.MockedFunction<typeof mockSlack.webClient.conversations.setTopic>;
				setTopic.mockImplementation(() => Promise.resolve({ok: true}));

				(getReactions as vi.MockedFunction<typeof getReactions>).mockResolvedValue(reactions);

				process.env.CHANNEL_SANDBOX = FAKE_SANDBOX;

				await topicHandler(mockSlack);

				const eventHandlers = mockSlack.eventClient.listeners('reaction_added');

				expect(eventHandlers).toHaveLength(1);

				await eventHandlers[0]({
					item: {
						channel: FAKE_SANDBOX,
						ts: MESSAGE_TS,
					},
					reaction,
				});
			};

			it('should set topic', async () => {
				const mockSlack = new Slack();

				await setupTest(mockSlack, 'Current Topic 1｜Current Topic 2／Current Topic 3', 'New Topic', 'koresuki', {
					koresuki: ['user1', 'user2', 'user3', 'user4', 'user5'],
				});

				expect(mockSlack.webClient.conversations.info).toBeCalledWith({
					channel: process.env.CHANNEL_SANDBOX,
				});
				expect(mockSlack.webClient.conversations.setTopic).toBeCalledWith({
					channel: process.env.CHANNEL_SANDBOX,
					topic: 'Current Topic 1｜New Topic｜Current Topic 2｜Current Topic 3',
				});
			});

			it('should not set topic if the incoming reaction is not koresuki', async () => {
				const mockSlack = new Slack();

				await setupTest(mockSlack, 'Current Topic', 'New Topic', 'invalid', {
					koresuki: ['user1', 'user2', 'user3', 'user4', 'user5'],
				});

				expect(mockSlack.webClient.conversations.setTopic).not.toBeCalled();
			});

			it('should not set topic for a non-qualifying message', async () => {
				const mockSlack = new Slack();

				await setupTest(mockSlack, 'Current Topic', 'Invalid\nMessage', 'koresuki', {
					koresuki: ['user1', 'user2', 'user3', 'user4', 'user5'],
				});

				expect(mockSlack.webClient.conversations.setTopic).not.toBeCalled();
			});

			it('should not set topic if the message is too long', async () => {
				const mockSlack = new Slack();

				await setupTest(mockSlack, 'Current Topic', 'A'.repeat(61), 'koresuki', {
					koresuki: ['user1', 'user2', 'user3', 'user4', 'user5'],
				});

				expect(mockSlack.webClient.conversations.setTopic).not.toBeCalled();
			});

			it('should not set topic if reactions are less than 5', async () => {
				const mockSlack = new Slack();

				await setupTest(mockSlack, 'Current Topic', 'New Topic', 'koresuki', {
					koresuki: ['user1', 'user2'],
				});

				expect(mockSlack.webClient.conversations.setTopic).not.toBeCalled();
			});

			it('should not set topic if one of 5 koresuki reactions is from the author', async () => {
				const mockSlack = new Slack();
				const MESSAGE_AUTHOR = 'U_AUTHOR';

				await setupTest(mockSlack, 'Current Topic', 'New Topic', 'koresuki', {
					koresuki: ['user1', 'user2', 'user3', 'user4', MESSAGE_AUTHOR],
				}, MESSAGE_AUTHOR);

				expect(mockSlack.webClient.conversations.setTopic).not.toBeCalled();
			});

			it('should set topic if 5 of 6 koresuki reactions are from others', async () => {
				const mockSlack = new Slack();
				const MESSAGE_AUTHOR = 'U_AUTHOR';

				await setupTest(mockSlack, 'Current Topic', 'New Topic', 'koresuki', {
					koresuki: ['user1', 'user2', 'user3', 'user4', 'user5', MESSAGE_AUTHOR],
				}, MESSAGE_AUTHOR);

				expect(mockSlack.webClient.conversations.setTopic).toBeCalled();
			});
		});
	});
});
