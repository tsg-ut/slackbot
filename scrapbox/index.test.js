"use strict";
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
const axios_1 = __importDefault(require("axios"));
const slackMock_1 = __importDefault(require("../lib/slackMock"));
const index_1 = __importStar(require("./index"));
jest.mock('axios');
// @ts-expect-error
axios_1.default.response = { data: {
        title: 'hoge',
        descriptions: ['fuga', 'piyo'],
        lines: [
            {
                id: 'f00a',
                text: 'fuga',
            },
            {
                id: '0140',
                text: 'piyo',
            },
        ],
    } };
let slack = null;
beforeEach(async () => {
    slack = new slackMock_1.default();
    process.env.CHANNEL_SANDBOX = slack.fakeChannel;
    await (0, index_1.default)(slack);
});
describe('scrapbox', () => {
    it('respond to slack hook of scrapbox unfurling', () => {
        const done = new Promise((resolve) => {
            slack.on('chat.unfurl', ({ unfurls }) => {
                expect(unfurls['https://scrapbox.io/tsg/hoge']).toBeTruthy();
                expect(unfurls['https://scrapbox.io/tsg/hoge'].text).toBe('fuga\npiyo');
                resolve();
            });
        });
        slack.eventClient.emit('link_shared', {
            type: 'link_shared',
            channel: 'Cxxxxxx',
            user: 'Uxxxxxxx',
            message_ts: '123452389.9875',
            thread_ts: '123456621.1855',
            links: [
                {
                    domain: 'scrapbox.io',
                    url: 'https://scrapbox.io/tsg/hoge',
                },
            ],
        });
        return done;
    });
    it('respond to slack hook of scrapbox unfurling with line specified', () => {
        const done = new Promise((resolve) => {
            slack.on('chat.unfurl', ({ unfurls }) => {
                expect(unfurls['https://scrapbox.io/tsg/hoge#0140']).toBeTruthy();
                expect(unfurls['https://scrapbox.io/tsg/hoge#0140'].text).toBe('piyo');
                resolve();
            });
        });
        slack.eventClient.emit('link_shared', {
            type: 'link_shared',
            channel: 'Cxxxxxx',
            user: 'Uxxxxxxx',
            message_ts: '123452389.9875',
            thread_ts: '123456621.1855',
            links: [
                {
                    domain: 'scrapbox.io',
                    url: 'https://scrapbox.io/tsg/hoge#0140',
                },
            ],
        });
        return done;
    });
    it('convert Scrapbox-style text to Slack-style text', () => {
        const exampleScrapboxText = `
			#debug #test
			[*** ひとこと]
			>カラオケの鉄人
			これすき [hideo54.icon] (ソース: [用語集])
			[* [太字内部リンク]] [* 太字2]
			[** [TSG 公式サイト https://tsg.ne.jp/]]
			[https://example.com] test [#sandbox]
		`;
        const expectedSlackText = `
			<https://scrapbox.io/tsg/debug|#debug> <https://scrapbox.io/tsg/test|#test>
			*ひとこと*
			>カラオケの鉄人
			これすき <https://scrapbox.io/tsg/hideo54|hideo54> (ソース: <https://scrapbox.io/tsg/用語集|用語集>)
			*<https://scrapbox.io/tsg/太字内部リンク|太字内部リンク>* *太字2*
			*<https://tsg.ne.jp/|TSG 公式サイト>*
			https://example.com test <https://scrapbox.io/tsg/#sandbox|#sandbox>
		`;
        expect((0, index_1.scrapbox2slack)(exampleScrapboxText)).toBe(expectedSlackText);
    });
});
