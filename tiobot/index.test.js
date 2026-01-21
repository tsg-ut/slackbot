"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const slackMock_1 = __importDefault(require("../lib/slackMock"));
const index_1 = __importDefault(require("./index"));
let slack = null;
beforeEach(() => {
    slack = new slackMock_1.default();
    process.env.CHANNEL_SANDBOX = slack.fakeChannel;
    (0, index_1.default)(slack);
});
describe('tiobot', () => {
    it('responds to tio.run URL', async () => {
        const response = await slack.getResponseTo('https://tio.run/##y0osSyxOLsosKNHNy09J/f8/OT@vOD8nVS8nP11DySM1JydfRyE8vygnRVFJ0/r/fwA');
        // eslint-disable-next-line no-restricted-syntax
        expect('username' in response && response.username).toBe('tiobot');
        expect(response.text).toBe('*javascript-node, 29 bytes* \n`console.log("Hello, World!");`');
    });
});
