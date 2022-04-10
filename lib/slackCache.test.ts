import fs from 'fs/promises';
import path from 'path';
import type {
	ConversationsHistoryArguments,
	UsersListArguments,
	EmojiListArguments,
} from '@slack/web-api/dist/methods';
import type {
	ConversationsHistoryResponse,
	UsersListResponse,
	EmojiListResponse,
} from '@slack/web-api/dist/response';

class WebClientMock {
	readonly users = {
		async list(args: UsersListArguments): Promise<UsersListResponse> {
			const fn = path.join(__dirname, '__testdata__/users.list.json');
			const json = await fs.readFile(fn);
			return JSON.parse(json.toString());
		},
	};
	readonly emoji = {
		async list(args: EmojiListArguments): Promise<EmojiListResponse> {
			const fn = path.join(__dirname, '__testdata__/emoji.list.json');
			const json = await fs.readFile(fn);
			return JSON.parse(json.toString());
		},
	};
	readonly conversations = {
		async history(args: ConversationsHistoryArguments): Promise<ConversationsHistoryResponse> {
			if (args.limit && args.limit !== 1) {
				throw Error('unsupported mock');
			}
			const fn = path.join(__dirname, '__testdata__/conversations.history.json');
			const json = await fs.readFile(fn);
			const res = JSON.parse(json.toString());

			if (!args.limit) {
				return res;
			}
			res.messages = res.messages.filter(({ts}: {ts: string}) => ts === args.latest);
			return res;
		},
	};
}

// @ts-expect-error
import Slack from './slackMock';
import SlackCache from './slackCache';

describe('SlackCache', () => {
	let slackCache: SlackCache = null;
	let rtm: Slack = null;
	beforeEach(async () => {
		rtm = new Slack();
		slackCache = new SlackCache({
			token: {
				team_id: 'T000',
				team_name: 'TEAM',
				access_token: 'xoxp-user',
				bot_user_id: 'fakebot',
				bot_access_token: 'xoxb-bot',
			},
			rtmClient: rtm,
			webClient: new WebClientMock,
			enableUsers: true,
			enableEmojis: true,
			enableReactions: true,
		});

		// HACK:
		//  constructorのwebClient callが処理されるより前に、RTM eventが来ちゃうとテストがおかしくなるので、
		//  loadUsersDeferred.promiseを待つ（ためにgetUsersを呼ぶ）。
		//  現実世界では、まあ、初期化の瞬間にRTM eventが来ることなんて滅多にないだろうし、気にしない気にしない。
		await slackCache.getUsers();
	});

	describe('getUsers', () => {
		it('returns all users at initialized', async () => {
			const got = Array.from(await slackCache.getUsers());
			expect(got).toHaveLength(2);

			const gotNames = new Set(got.map(({name}) => name))
			expect(gotNames).toEqual(new Set(['normal user', 'slackbot']));

			const gotIds = new Set(got.map(({id}) => id))
			expect(gotIds).toEqual(new Set(['U12345678', 'USLACKBOT']));
		});

		it('watches team_join', async () => {
			/// NOTE: 適当に作りました、たぶんこんなフォーマットでしょ
			rtm.emit('team_join', {
				"user": {
					"id": "U22222222",
					"team_id": "T00000000",
					"name": "new user",
				}
			});

			const got = Array.from(await slackCache.getUsers());
			expect(got).toHaveLength(3);

			const gotNames = new Set(got.map(({name}) => name))
			expect(gotNames).toEqual(new Set(['normal user', 'new user', 'slackbot']));

			const gotIds = new Set(got.map(({id}) => id))
			expect(gotIds).toEqual(new Set(['U12345678', 'U22222222', 'USLACKBOT']));
		});
		it('watches user_change', async () => {
			/// NOTE: 適当に作りました、たぶんこんなフォーマットでしょ２
			await rtm.emit('user_change', {
				"user": {
					"id": "U12345678",
					"team_id": "T00000000",
					"name": "special user",
				}
			});

			const got = Array.from(await slackCache.getUsers());
			expect(got).toHaveLength(2);

			const gotNames = new Set(got.map(({name}) => name))
			expect(gotNames).toEqual(new Set(['special user', 'slackbot']));

			const gotIds = new Set(got.map(({id}) => id))
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
			rtm.emit('team_join', {
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
			await rtm.emit('user_change', {
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
			rtm.emit('emoji_changed', {
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
			expect(react1).toEqual({ojigineko: 1, slack: 2});
			const react2 = await slackCache.getReactions('C00000000', '1640001000.000000');
			expect(react2).toEqual({});
		});
		it('watches reaction_added/deleted', async () => {
			rtm.emit('reaction_added', {
				"item": { "channel": "C00000000", "ts": "1640000000.000000" },
				"reaction": "ojigineko",
			}); // history fetch, {ojigineko: 1, slack: 2}
			rtm.emit('reaction_added', {
				"item": { "channel": "C00000000", "ts": "1640000000.000000" },
				"reaction": "ojigineko",
			}); // ojigineko: 2
			rtm.emit('reaction_added', {
				"item": { "channel": "C00000000", "ts": "1640000000.000000" },
				"reaction": "white_square",
			}); // white_square: 1
			rtm.emit('reaction_added', {
				"item": { "channel": "C00000000", "ts": "1640000000.000000" },
				"reaction": "ojigineko",
			}); // ojigineko: 3
			rtm.emit('reaction_removed', {
				"item": { "channel": "C00000000", "ts": "1640000000.000000" },
				"reaction": "slack",
			}); // slack: 1
			rtm.emit('reaction_added', {
				"item": { "channel": "C00000000", "ts": "1640000000.000000" },
				"reaction": "white_square",
			}); // white_square: 2

			rtm.emit('reaction_added', {
				"item": { "channel": "C00000000", "ts": "1640001000.000000" },
				"reaction": "dummy",
			}); // history fetch, {}
			rtm.emit('reaction_added', {
				"item": { "channel": "C00000000", "ts": "1640001000.000000" },
				"reaction": "ojigineko",
			}); // ojigineko: 1

			const react1 = await slackCache.getReactions('C00000000', '1640000000.000000');
			expect(react1).toEqual({ojigineko: 3, slack: 1, white_square: 2});
			const react2 = await slackCache.getReactions('C00000000', '1640001000.000000');
			expect(react2).toEqual({ojigineko: 1});
		});
	});
})
