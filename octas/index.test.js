"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
jest.mock('cloudinary');
const index_1 = __importDefault(require("./index"));
const slackMock_1 = __importDefault(require("../lib/slackMock"));
let slack = null;
beforeEach(async () => {
    slack = new slackMock_1.default();
    process.env.CHANNEL_SANDBOX = slack.fakeChannel;
    await (0, index_1.default)(slack);
});
describe('octas', () => {
    it('respond to octas', async () => {
        const response = await slack.getResponseTo('octas');
        const { channel, text } = response;
        const attachments = 'attachments' in response ? response.attachments : [];
        expect(channel).toBe(slack.fakeChannel);
        expect(text).toContain('Octas対人を始めるよ～');
        expect(attachments).toHaveLength(1);
    });
});
