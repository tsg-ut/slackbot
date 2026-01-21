"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
/* eslint-disable no-undef */
const noop_1 = __importDefault(require("lodash/noop"));
// @ts-expect-error
const mock_cloud_firestore_1 = __importDefault(require("mock-cloud-firestore"));
const slackMock_1 = __importDefault(require("../lib/slackMock"));
const index_production_1 = __importDefault(require("./index_production"));
let slack = null;
jest.mock('../lib/slackUtils');
jest.mock('../lib/state');
jest.mock('../lib/firestore', () => {
    const firebase = new mock_cloud_firestore_1.default({});
    const db = firebase.firestore();
    db.runTransaction = noop_1.default;
    return { db };
});
beforeEach(() => {
    slack = new slackMock_1.default();
    process.env.CHANNEL_SANDBOX = slack.fakeChannel;
    (0, index_production_1.default)(slack);
});
describe('achievements', () => {
    it('unlock chat achievement when chat is posted', async () => {
        const response = await slack.getResponseTo('hoge');
        // eslint-disable-next-line no-restricted-syntax
        expect('username' in response && response.username).toBe('achievements');
        expect(response.text).toContain('はじめまして!');
    });
});
