import fs from 'fs-extra';
import path from 'path';
import type {
	ConversationsHistoryArguments,
	ConversationsHistoryResponse,
	UsersListArguments,
	UsersListResponse,
	EmojiListArguments,
	EmojiListResponse,
} from '@slack/web-api';
import Slack from './slackMock';
import SlackCache from './slackCache';

const userA = "USLACKBOT";
const userB = "U12345678";
const userC = "U31415926";
const userD = "UTSGTSGTS";

class WebClientMock {
	readonly users = {
		async list(args: UsersListArguments): Promise<UsersListResponse> {
			const fn = path.join(__dirname, '__testdata__/users.list.json');
			return await fs.readJson(fn);
		},
	};
	readonly emoji = {
		async list(args: EmojiListArguments): Promise<EmojiListResponse> {
			const fn = path.join(__dirname, '__testdata__/emoji.list.json');
			return await fs.readJson(fn);
		},
	};
	readonly conversations = {
		async history(args: ConversationsHistoryArguments): Promise<ConversationsHistoryResponse> {
			if (args.limit && args.limit !== 1) {
				throw Error('unsupported mock');
			}
			const fn = path.join(__dirname, '__testdata__/conversations.history.json');
			const res = await fs.readJson(fn);

			if (!args.limit) {
				return res;
			}
			res.messages = res.messages.filter(({ts}: {ts: string}) => ts === args.latest);
			return res;
		},
	};
}

describe('SlackCache', () => {
	const teamId = 'T000000';
	let slackCache: SlackCache = null;
	let slack: Slack = null;
	const emit = async (event: string, payload: any) => {
		await slack.eventClient.emit(event, payload, {
			team_id: teamId,
		});
	};
	beforeEach(async () => {
		slack = new Slack();
		slackCache = new SlackCache({
			token: {
				team_id: teamId,
				team_name: 'TEAM',
				access_token: 'xoxp-user',
				bot_user_id: 'fakebot',
				bot_access_token: 'xoxb-bot',
			},
			eventClient: slack.eventClient,
			webClient: new WebClientMock(),
			enableReactions: true,
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

			const gotNames = new Set(got.map(({name}) => name))
			expect(gotNames).toEqual(new Set(['normal user', 'slackbot']));

			const gotIds = new Set(got.map(({id}) => id))
			expect(gotIds).toEqual(new Set(['U12345678', 'USLACKBOT']));
		});

		it('watches team_join', async () => {
			// NOTE: 適当に作りました、たぶんこんなフォーマットでしょ
			await emit('team_join', {
				'user': {
					'id': 'U22222222',
					'team_id': 'T00000000',
					'name': 'new user',
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
			// NOTE: 適当に作りました、たぶんこんなフォーマットでしょ２
			await emit('user_change', {
				'user': {
					'id': 'U12345678',
					'team_id': 'T00000000',
					'name': 'special user',
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
			await emit('team_join', {
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
			await emit('user_change', {
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
			await emit('emoji_changed', {
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
			await emit('reaction_added', {
				"item": { "channel": "C00000000", "ts": "1640000000.000000" },
				"reaction": "ojigineko",
				"user": userC,
			}); // history fetch, {ojigineko: [B], slack: [A, B]}
			await emit('reaction_added', {
				"item": { "channel": "C00000000", "ts": "1640000000.000000" },
				"reaction": "ojigineko",
				"user": userB,
			}); // ojigineko: [B] (already reacted)
			await emit('reaction_added', {
				"item": { "channel": "C00000000", "ts": "1640000000.000000" },
				"reaction": "white_square",
				"user": userD,
			}); // white_square: [D]
			await emit('reaction_added', {
				"item": { "channel": "C00000000", "ts": "1640000000.000000" },
				"reaction": "ojigineko",
				"user": userA,
			}); // ojigineko: [B, A]
			await emit('reaction_removed', {
				"item": { "channel": "C00000000", "ts": "1640000000.000000" },
				"reaction": "slack",
				"user": userA,
			}); // slack: [B]
			await emit('reaction_added', {
				"item": { "channel": "C00000000", "ts": "1640000000.000000" },
				"reaction": "white_square",
				"user": userD,
			}); // white_square: [D] (already reacted)
			await emit('reaction_removed', {
				"item": { "channel": "C00000000", "ts": "1640000000.000000" },
				"reaction": "slack",
				"user": userA,
			}); // slack: [B] (already removed)

			await emit('reaction_added', {
				"item": { "channel": "C00000000", "ts": "1640001000.000000" },
				"reaction": "dummy",
				"user": userA,
			}); // history fetch, {}
			await emit('reaction_added', {
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
})
