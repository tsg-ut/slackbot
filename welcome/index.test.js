"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const axios_1 = __importDefault(require("axios"));
const slackMock_1 = __importDefault(require("../lib/slackMock"));
const index_1 = __importDefault(require("./index"));
jest.mock('axios');
const apiData = `:tada:TSGへようこそ！:tada:
uouofishlife. uouo. uouo.

*Slackについて* :slack:
ここはオンラインチャットツールSlackの、TSGのスペースです。
`;
const welcomeMessage = `:tada:TSGへようこそ！:tada:
uouofishlife. uouo. uouo.

*Slackについて* :slack:
ここはオンラインチャットツールSlackの、TSGのスペースです。
`;
// @ts-expect-error
axios_1.default.response = {
    data: apiData,
};
let slack = null;
beforeEach(async () => {
    slack = new slackMock_1.default();
    await (0, index_1.default)(slack);
});
describe('welcome', () => {
    it('respond to DM welcome', async () => {
        const fakeDMChannel = 'Dxxxxxx';
        slack.fakeChannel = fakeDMChannel;
        const resp = await slack.getResponseTo('welcome');
        const { text } = resp;
        expect(text).toBe(welcomeMessage);
    });
});
