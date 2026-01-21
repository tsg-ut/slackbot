"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
jest.mock('axios');
jest.mock('../lib/slackUtils');
jest.mock('../lib/download');
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
jest.mock('fs');
// @ts-expect-error
fs_1.default.virtualFiles = {
    [path_1.default.join(__dirname, 'data')]: '',
    [path_1.default.join(__dirname, 'data', 'emoji.json')]: `[{"short_names":["hoge","huga"]}]`,
    [path_1.default.join(__dirname, 'data', 'common_word_list')]: `シコウサクゴ,試行錯誤`,
};
const index_1 = __importDefault(require("./index"));
const slackMock_1 = __importDefault(require("../lib/slackMock"));
let slack = null;
beforeEach(async () => {
    slack = new slackMock_1.default();
    process.env.CHANNEL_SANDBOX = slack.fakeChannel;
    await (0, index_1.default)(slack);
});
describe('ponpe', () => {
    it('responds to ぽんぺ出題', async () => {
        const response = await slack.getResponseTo('ぽんぺ出題');
        expect('username' in response && response.username).toBe('ぽんぺマスター');
        expect(response.text).toMatch(/^ぽんぺをはじめるよ:waiwai:。/);
    });
});
