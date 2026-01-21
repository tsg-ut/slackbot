"use strict";
/* eslint-disable import/imports-first */
/* eslint-disable import/first */
/* eslint-env node, jest */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
jest.mock('cloudinary');
jest.mock('node-persist');
jest.mock('./render');
jest.mock('./fetch');
jest.mock('../lib/slackUtils');
jest.mock('../lib/state');
jest.mock('../lib/openai', () => ({
    __esModule: true,
    default: {
        chat: {
            completions: {
                create: jest.fn(),
            },
        },
    },
}));
const fake_timers_1 = __importDefault(require("@sinonjs/fake-timers"));
const slackMock_1 = __importDefault(require("../lib/slackMock"));
const index_1 = __importDefault(require("./index"));
let slack = null;
let clock = null;
describe('sunrise', () => {
    beforeEach(async () => {
        slack = new slackMock_1.default();
        clock = fake_timers_1.default.install();
        process.env.CHANNEL_SANDBOX = slack.fakeChannel;
        await (0, index_1.default)(slack);
    });
    afterEach(() => {
        if (clock !== null) {
            clock.uninstall();
        }
    });
    it('notify sunrise on sunrise', () => new Promise((resolve) => {
        clock.setSystemTime(new Date('2019-03-21T06:00:00+0900'));
        slack.on('chat.postMessage', ({ text }) => {
            if (!text.includes('wave')) {
                expect(text).toContain('ahokusa');
                resolve();
            }
        });
        clock.tick(15 * 1000);
    }));
    it('notify sunset on sunset', () => new Promise((resolve) => {
        clock.setSystemTime(new Date('2019-03-21T19:00:00+0900'));
        slack.on('chat.postMessage', ({ text }) => {
            if (!text.includes('ahokusa')) {
                expect(text).toContain('wave');
                resolve();
            }
        });
        clock.tick(15 * 1000);
    }));
});
