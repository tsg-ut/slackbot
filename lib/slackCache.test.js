"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const fs_extra_1 = __importDefault(require("fs-extra"));
const path_1 = __importDefault(require("path"));
const slackMock_1 = __importDefault(require("./slackMock"));
const slackCache_1 = __importDefault(require("./slackCache"));
const slackPatron_1 = require("./slackPatron");
jest.mock('./slackPatron', () => ({
    __esModule: true,
    conversationsHistory: jest.fn(),
    conversationsReplies: jest.fn(),
}));
jest.mock('./eventDeduplication', () => ({
    getDuplicateEventChecker: jest.fn(() => ({
        markEventAsProcessed: jest.fn().mockResolvedValue(false),
    })),
}));
const userA = "USLACKBOT";
const userB = "U12345678";
const userC = "U31415926";
const userD = "UTSGTSGTS";
describe('SlackCache', () => {
    const teamId = 'T00000000';
    let slackCache = null;
    let slack = null;
    const emit = (event, payload) => {
        slack.eventClient.emit(event, payload, {
            team_id: teamId,
        });
    };
    beforeEach(async () => {
        slack = new slackMock_1.default();
        // Setup mock for conversationsHistory
        const mockConversationsHistory = jest.mocked(slackPatron_1.conversationsHistory);
        mockConversationsHistory.mockImplementation(async (args) => {
            if (args.limit && args.limit !== 1) {
                throw Error('unsupported mock');
            }
            const fn = path_1.default.join(__dirname, '__testdata__/conversations.history.json');
            const res = await fs_extra_1.default.readJson(fn);
            if (!args.limit) {
                return res;
            }
            res.messages = res.messages.filter(({ ts }) => ts === args.latest);
            return res;
        });
        const mockedUsersList = jest.mocked(slack.webClient.users.list);
        mockedUsersList.mockImplementation(async () => {
            const fn = path_1.default.join(__dirname, '__testdata__/users.list.json');
            return fs_extra_1.default.readJson(fn);
        });
        const mockedEmojiList = jest.mocked(slack.webClient.emoji.list);
        mockedEmojiList.mockImplementation(async () => {
            const fn = path_1.default.join(__dirname, '__testdata__/emoji.list.json');
            return fs_extra_1.default.readJson(fn);
        });
        slackCache = new slackCache_1.default({
            token: {
                team_id: teamId,
                team_name: 'TEAM',
                access_token: 'xoxp-user',
                bot_user_id: 'fakebot',
                bot_access_token: 'xoxb-bot',
            },
            eventClient: slack.eventClient,
            webClient: slack.webClient,
        });
        // HACK:
        //  constructorのwebClient callが処理されるより前に、eventが来ちゃうとテストがおかしくなるので、
        //  loadUsersDeferred.promiseを待つ（ためにgetUsersを呼ぶ）。
        //  現実世界では、まあ、初期化の瞬間にeventが来ることなんて滅多にないだろうし、気にしない気にしない。
        await slackCache.getUsers();
    });
    describe('getUsers', () => {
        it('returns all users at initialized', async () => {
            const got = Array.from(await slackCache.getUsers());
            expect(got).toHaveLength(2);
            const gotNames = new Set(got.map(({ name }) => name));
            expect(gotNames).toEqual(new Set(['normal user', 'slackbot']));
            const gotIds = new Set(got.map(({ id }) => id));
            expect(gotIds).toEqual(new Set(['U12345678', 'USLACKBOT']));
        });
        it('watches team_join', async () => {
            // NOTE: 適当に作りました、たぶんこんなフォーマットでしょ
            emit('team_join', {
                'user': {
                    'id': 'U22222222',
                    'team_id': 'T00000000',
                    'name': 'new user',
                }
            });
            const got = Array.from(await slackCache.getUsers());
            expect(got).toHaveLength(3);
            const gotNames = new Set(got.map(({ name }) => name));
            expect(gotNames).toEqual(new Set(['normal user', 'new user', 'slackbot']));
            const gotIds = new Set(got.map(({ id }) => id));
            expect(gotIds).toEqual(new Set(['U12345678', 'U22222222', 'USLACKBOT']));
        });
        it('watches user_change', async () => {
            // NOTE: 適当に作りました、たぶんこんなフォーマットでしょ２
            emit('user_change', {
                'user': {
                    'id': 'U12345678',
                    'team_id': 'T00000000',
                    'name': 'special user',
                }
            });
            const got = Array.from(await slackCache.getUsers());
            expect(got).toHaveLength(2);
            const gotNames = new Set(got.map(({ name }) => name));
            expect(gotNames).toEqual(new Set(['special user', 'slackbot']));
            const gotIds = new Set(got.map(({ id }) => id));
            expect(gotIds).toEqual(new Set(['U12345678', 'USLACKBOT']));
        });
    });
    describe('getUser', () => {
        it('returns user at initialized', async () => {
            const user1 = await slackCache.getUser('U12345678');
            expect(user1).not.toBeUndefined();
            expect(user1.name).toBe('normal user');
            const user2 = await slackCache.getUser('USLACKBOT');
            expect(user2).not.toBeUndefined();
            expect(user2.name).toBe('slackbot');
            const user3 = await slackCache.getUser('U22222222');
            expect(user3).toBeUndefined();
        });
        it('watches team_join', async () => {
            emit('team_join', {
                "user": {
                    "id": "U22222222",
                    "team_id": "T00000000",
                    "name": "new user",
                }
            });
            const user1 = await slackCache.getUser('U12345678');
            expect(user1).not.toBeUndefined();
            expect(user1.name).toBe('normal user');
            const user2 = await slackCache.getUser('USLACKBOT');
            expect(user2).not.toBeUndefined();
            expect(user2.name).toBe('slackbot');
            const user3 = await slackCache.getUser('U22222222');
            expect(user3).not.toBeUndefined();
            expect(user3.name).toBe('new user');
        });
        it('watches user_change', async () => {
            emit('user_change', {
                "user": {
                    "id": "U12345678",
                    "team_id": "T00000000",
                    "name": "special user",
                }
            });
            const user1 = await slackCache.getUser('U12345678');
            expect(user1).not.toBeUndefined();
            expect(user1.name).toBe('special user');
            const user2 = await slackCache.getUser('USLACKBOT');
            expect(user2).not.toBeUndefined();
            expect(user2.name).toBe('slackbot');
        });
    });
    describe('getEmoji', () => {
        it('returns emoji at initialized', async () => {
            const emoji1 = await slackCache.getEmoji('slack');
            expect(emoji1).toBe('https://emoji.slack-edge.com/T00000000/slack/0123456789.png');
            const emoji2 = await slackCache.getEmoji('dot-ojigineko');
            expect(emoji2).toBeUndefined();
        });
        it('watches emoji_changed', async () => {
            emit('emoji_changed', {
                "subtype": "add",
                "name": "dot-ojigineko",
                "value": "https://emoji.slack-edge.com/T00000000/dot-ojigineko/0123456789.png",
            });
            const emoji1 = await slackCache.getEmoji('slack');
            expect(emoji1).toBe('https://emoji.slack-edge.com/T00000000/slack/0123456789.png');
            const emoji2 = await slackCache.getEmoji('dot-ojigineko');
            expect(emoji2).toBe('https://emoji.slack-edge.com/T00000000/dot-ojigineko/0123456789.png');
        });
    });
    describe('getReactions', () => {
        it('returns reactions', async () => {
            const react1 = await slackCache.getReactions('C00000000', '1640000000.000000');
            expect(react1).toEqual({
                ojigineko: [userB],
                slack: [userA, userB],
            });
            const react2 = await slackCache.getReactions('C00000000', '1640001000.000000');
            expect(react2).toEqual({});
        });
        it('watches reaction_added/deleted', async () => {
            emit('reaction_added', {
                "item": { "channel": "C00000000", "ts": "1640000000.000000" },
                "reaction": "ojigineko",
                "user": userC,
            }); // history fetch, {ojigineko: [B], slack: [A, B]}
            emit('reaction_added', {
                "item": { "channel": "C00000000", "ts": "1640000000.000000" },
                "reaction": "ojigineko",
                "user": userB,
            }); // ojigineko: [B] (already reacted)
            emit('reaction_added', {
                "item": { "channel": "C00000000", "ts": "1640000000.000000" },
                "reaction": "white_square",
                "user": userD,
            }); // white_square: [D]
            emit('reaction_added', {
                "item": { "channel": "C00000000", "ts": "1640000000.000000" },
                "reaction": "ojigineko",
                "user": userA,
            }); // ojigineko: [B, A]
            emit('reaction_removed', {
                "item": { "channel": "C00000000", "ts": "1640000000.000000" },
                "reaction": "slack",
                "user": userA,
            }); // slack: [B]
            emit('reaction_added', {
                "item": { "channel": "C00000000", "ts": "1640000000.000000" },
                "reaction": "white_square",
                "user": userD,
            }); // white_square: [D] (already reacted)
            emit('reaction_removed', {
                "item": { "channel": "C00000000", "ts": "1640000000.000000" },
                "reaction": "slack",
                "user": userA,
            }); // slack: [B] (already removed)
            emit('reaction_added', {
                "item": { "channel": "C00000000", "ts": "1640001000.000000" },
                "reaction": "dummy",
                "user": userA,
            }); // history fetch, {}
            emit('reaction_added', {
                "item": { "channel": "C00000000", "ts": "1640001000.000000" },
                "reaction": "ojigineko",
                "user": userA,
            }); // ojigineko: [A]
            const react1 = await slackCache.getReactions('C00000000', '1640000000.000000');
            expect(react1).toEqual({
                ojigineko: [userB, userA],
                slack: [userB],
                white_square: [userD],
            });
            const react2 = await slackCache.getReactions('C00000000', '1640001000.000000');
            expect(react2).toEqual({
                ojigineko: [userA],
            });
        });
    });
});
