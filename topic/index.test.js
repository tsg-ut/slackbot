"use strict";
/* eslint-disable callback-return */
/* eslint-disable node/callback-return */
/* eslint-disable import/imports-first */
/* eslint-disable import/first */
/* eslint-env jest */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
jest.mock('../lib/state');
jest.mock('../lib/slack');
jest.mock('../lib/slackUtils', () => ({
    __esModule: true,
    getReactions: jest.fn(),
}));
jest.mock('../lib/slackPatron', () => ({
    __esModule: true,
    conversationsHistory: jest.fn(),
    conversationsReplies: jest.fn(),
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
const firestore_1 = __importDefault(require("../lib/firestore"));
const slackPatron_1 = require("../lib/slackPatron");
const slackMock_1 = __importDefault(require("../lib/slackMock"));
const slackUtils_1 = require("../lib/slackUtils");
const index_1 = __importStar(require("./index"));
const runTransaction = firestore_1.default.runTransaction;
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
                    await callback(mockTransaction);
                });
                mockTransaction.get.mockResolvedValue(mockDoc);
                await (0, index_1.addLike)('user1', '12345');
                expect(mockTransaction.get).toBeCalledWith(firestore_1.default.collection('topic_messages').doc('12345'));
                expect(mockTransaction.update).toBeCalledWith(firestore_1.default.collection('topic_messages').doc('12345'), { likes: ['user1'] });
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
                    await callback(mockTransaction);
                });
                mockTransaction.get.mockResolvedValue(mockDoc);
                await (0, index_1.addLike)('user1', '12345');
                expect(mockTransaction.get).toBeCalledWith(firestore_1.default.collection('topic_messages').doc('12345'));
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
                    await callback(mockTransaction);
                });
                mockTransaction.get.mockResolvedValue(mockDoc);
                await (0, index_1.removeLike)('user1', '12345');
                expect(mockTransaction.get).toBeCalledWith(firestore_1.default.collection('topic_messages').doc('12345'));
                expect(mockTransaction.update).toBeCalledWith(firestore_1.default.collection('topic_messages').doc('12345'), { likes: [] });
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
                    await callback(mockTransaction);
                });
                mockTransaction.get.mockResolvedValue(mockDoc);
                await (0, index_1.removeLike)('user1', '12345');
                expect(mockTransaction.get).toBeCalledWith(firestore_1.default.collection('topic_messages').doc('12345'));
                expect(mockTransaction.update).not.toBeCalled();
            });
        });
        describe('topicHandler', () => {
            const setupTest = async (mockSlack, currentTopic, message, reaction, reactions, messageUser) => {
                const MESSAGE_TS = '12345';
                const converastionsInfo = mockSlack.webClient.conversations.info;
                converastionsInfo.mockResolvedValue({
                    ok: true,
                    channel: {
                        topic: {
                            value: currentTopic,
                        },
                    },
                });
                const mockConversationsHistory = slackPatron_1.conversationsHistory;
                mockConversationsHistory.mockResolvedValue({
                    ok: true,
                    messages: [{
                            ts: MESSAGE_TS,
                            text: message,
                            user: messageUser,
                        }],
                });
                const setTopic = mockSlack.webClient.conversations.setTopic;
                setTopic.mockImplementation(() => Promise.resolve({ ok: true }));
                slackUtils_1.getReactions.mockResolvedValue(reactions);
                process.env.CHANNEL_SANDBOX = FAKE_SANDBOX;
                await (0, index_1.default)(mockSlack);
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
                const mockSlack = new slackMock_1.default();
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
                const mockSlack = new slackMock_1.default();
                await setupTest(mockSlack, 'Current Topic', 'New Topic', 'invalid', {
                    koresuki: ['user1', 'user2', 'user3', 'user4', 'user5'],
                });
                expect(mockSlack.webClient.conversations.setTopic).not.toBeCalled();
            });
            it('should not set topic for a non-qualifying message', async () => {
                const mockSlack = new slackMock_1.default();
                await setupTest(mockSlack, 'Current Topic', 'Invalid\nMessage', 'koresuki', {
                    koresuki: ['user1', 'user2', 'user3', 'user4', 'user5'],
                });
                expect(mockSlack.webClient.conversations.setTopic).not.toBeCalled();
            });
            it('should not set topic if the message is too long', async () => {
                const mockSlack = new slackMock_1.default();
                await setupTest(mockSlack, 'Current Topic', 'A'.repeat(61), 'koresuki', {
                    koresuki: ['user1', 'user2', 'user3', 'user4', 'user5'],
                });
                expect(mockSlack.webClient.conversations.setTopic).not.toBeCalled();
            });
            it('should not set topic if reactions are less than 5', async () => {
                const mockSlack = new slackMock_1.default();
                await setupTest(mockSlack, 'Current Topic', 'New Topic', 'koresuki', {
                    koresuki: ['user1', 'user2'],
                });
                expect(mockSlack.webClient.conversations.setTopic).not.toBeCalled();
            });
            it('should not set topic if one of 5 koresuki reactions is from the author', async () => {
                const mockSlack = new slackMock_1.default();
                const MESSAGE_AUTHOR = 'U_AUTHOR';
                await setupTest(mockSlack, 'Current Topic', 'New Topic', 'koresuki', {
                    koresuki: ['user1', 'user2', 'user3', 'user4', MESSAGE_AUTHOR],
                }, MESSAGE_AUTHOR);
                expect(mockSlack.webClient.conversations.setTopic).not.toBeCalled();
            });
            it('should set topic if 5 of 6 koresuki reactions are from others', async () => {
                const mockSlack = new slackMock_1.default();
                const MESSAGE_AUTHOR = 'U_AUTHOR';
                await setupTest(mockSlack, 'Current Topic', 'New Topic', 'koresuki', {
                    koresuki: ['user1', 'user2', 'user3', 'user4', 'user5', MESSAGE_AUTHOR],
                }, MESSAGE_AUTHOR);
                expect(mockSlack.webClient.conversations.setTopic).toBeCalled();
            });
        });
    });
});
