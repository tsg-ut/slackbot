import fs from 'fs-extra';
import path from 'path';
import Slack from './slackMock';
import SlackCache from './slackCache';
import {conversationsHistory} from './slackPatron';

vi.mock('./slackPatron', () => ({
	__esModule: true,
	conversationsHistory: vi.fn(),
	conversationsReplies: vi.fn(),
}));

vi.mock('./eventDeduplication', () => ({
	getDuplicateEventChecker: vi.fn(() => ({
		markEventAsProcessed: vi.fn().mockResolvedValue(false),
	})),
}));

const userA = "USLACKBOT";
const userB = "U12345678";
const userC = "U31415926";
const userD = "UTSGTSGTS";

describe('SlackCache', () => {
	const teamId = 'T00000000';
	let slackCache: SlackCache = null;
	let slack: Slack = null;
	const emit = (event: string, payload: any) => {
		slack.eventClient.emit(event, payload, {
			team_id: teamId,
		});
	};
	beforeEach(async () => {
		slack = new Slack();
		
		// Setup mock for conversationsHistory
		const mockConversationsHistory = vi.mocked(conversationsHistory);
		mockConversationsHistory.mockImplementation(async (args) => {
			if (args.limit && args.limit !== 1) {
				throw Error('unsupported mock');
			}
			const fn = path.join(__dirname, '__testdata__/conversations.history.json');
			// Use sync read to ensure all concurrent modifyReaction calls get already-resolved
			// promises, making microtask resolution order deterministic (FIFO).
			// With async readJson, CI and local environments may resolve in different orders,
			// causing non-deterministic test outcomes.
			const res = fs.readJsonSync(fn);

			if (!args.limit) {
				return res;
			}
			res.messages = res.messages.filter(({ts}: {ts: string}) => ts === args.latest);
			return res;
		});

		const mockedUsersList = vi.mocked(slack.webClient.users.list);
		mockedUsersList.mockImplementation(async () => {
			const fn = path.join(__dirname, '__testdata__/users.list.json');
			return fs.readJson(fn);
		});

		const mockedEmojiList = vi.mocked(slack.webClient.emoji.list);
		mockedEmojiList.mockImplementation(async () => {
			const fn = path.join(__dirname, '__testdata__/emoji.list.json');
			return fs.readJson(fn);
		});

		slackCache = new SlackCache({
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

			const gotNames = new Set(got.map(({name}) => name))
			expect(gotNames).toEqual(new Set(['normal user', 'slackbot']));

			const gotIds = new Set(got.map(({id}) => id))
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

			const gotNames = new Set(got.map(({name}) => name))
			expect(gotNames).toEqual(new Set(['normal user', 'new user', 'slackbot']));

			const gotIds = new Set(got.map(({id}) => id))
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
		it('loads lazily and shares the request between concurrent readers', async () => {
			expect(vi.mocked(slack.webClient.emoji.list).mock.calls).toHaveLength(0);
			const [emoji, emojis] = await Promise.all([
				slackCache.getEmoji('slack'),
				slackCache.getEmojis(),
			]);
			expect(emoji).toBe(emojis.slack);
			expect(slack.webClient.emoji.list).toHaveBeenCalledTimes(1);
		});

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

		it('keeps multiple names and aliases for the same image in a detached snapshot', async () => {
			const url = await slackCache.getEmoji('slack');
			emit('emoji_changed', {subtype: 'add', name: 'same_image', value: url});
			emit('emoji_changed', {subtype: 'add', name: 'another_alias', value: 'alias:white_square'});
			const emojis = await slackCache.getEmojis();
			expect(emojis).toMatchObject({slack: url, same_image: url, white_square: 'alias:slack', another_alias: 'alias:white_square'});
			delete emojis.slack;
			expect(await slackCache.getEmoji('slack')).toBe(url);
			expect(slack.webClient.emoji.list).toHaveBeenCalledTimes(1);
		});

		it('removes all listed names and chained aliases while preserving independent names', async () => {
			const url = await slackCache.getEmoji('slack');
			emit('emoji_changed', {subtype: 'add', name: 'same_image', value: url});
			emit('emoji_changed', {subtype: 'add', name: 'chain', value: 'alias:white_square'});
			emit('emoji_changed', {subtype: 'remove', names: ['slack', 'ojigineko']});
			expect(await slackCache.getEmojis()).toEqual({same_image: url});
		});

		it('removes an alias without removing its original or other aliases', async () => {
			await slackCache.getEmojis();
			emit('emoji_changed', {subtype: 'remove', names: ['white_square']});
			expect(await slackCache.getEmoji('white_square')).toBeUndefined();
			expect(await slackCache.getEmoji('slack')).toBeDefined();
		});

		it('renames an emoji and updates alias references without losing other names', async () => {
			const url = await slackCache.getEmoji('slack');
			emit('emoji_changed', {subtype: 'add', name: 'same_image', value: url});
			emit('emoji_changed', {subtype: 'rename', old_name: 'slack', new_name: 'renamed', value: url});
			expect(await slackCache.getEmoji('slack')).toBeUndefined();
			expect(await slackCache.getEmojis()).toMatchObject({renamed: url, same_image: url, white_square: 'alias:renamed'});
		});

		it('renames aliases and preserves their targets', async () => {
			await slackCache.getEmojis();
			emit('emoji_changed', {subtype: 'add', name: 'chain', value: 'alias:white_square'});
			emit('emoji_changed', {subtype: 'rename', old_name: 'white_square', new_name: 'alias_name', value: 'alias:slack'});
			expect(await slackCache.getEmoji('white_square')).toBeUndefined();
			expect(await slackCache.getEmojis()).toMatchObject({alias_name: 'alias:slack', chain: 'alias:alias_name'});
		});

		it('applies events arriving during initial loading after the snapshot', async () => {
			const list = vi.mocked(slack.webClient.emoji.list);
			let resolveList: (response: {ok: boolean; emoji: Record<string, string>}) => void;
			list.mockReturnValueOnce(new Promise((resolve) => { resolveList = resolve; }));
			const cache = new SlackCache({
				token: {team_id: teamId, team_name: 'TEAM', access_token: 'user', bot_user_id: 'bot', bot_access_token: 'bot'},
				eventClient: slack.eventClient,
				webClient: slack.webClient,
			});
			const emojis = cache.getEmojis();
			emit('emoji_changed', {subtype: 'rename', old_name: 'old', new_name: 'new', value: 'https://example/image.png'});
			emit('emoji_changed', {subtype: 'remove', names: ['removed']});
			resolveList({ok: true, emoji: {old: 'https://example/image.png', removed: 'https://example/removed.png'}});
			expect(await emojis).toEqual({new: 'https://example/image.png'});
		});

		it('retries failed loading instead of leaving readers waiting', async () => {
			vi.mocked(slack.webClient.emoji.list).mockRejectedValueOnce(new Error('failed'));
			const cache = new SlackCache({
				token: {team_id: teamId, team_name: 'TEAM', access_token: 'user', bot_user_id: 'bot', bot_access_token: 'bot'},
				eventClient: slack.eventClient,
				webClient: slack.webClient,
			});
			await expect(cache.getEmojis()).rejects.toThrow('failed');
			expect(await cache.getEmoji('slack')).toBeDefined();
		});

		it('reloads unknown events and applies subsequent changes in order', async () => {
			await slackCache.getEmojis();
			vi.mocked(slack.webClient.emoji.list).mockResolvedValueOnce({ok: true, emoji: {fresh: 'https://example/fresh.png'}});
			emit('emoji_changed', {});
			emit('emoji_changed', {subtype: 'rename', old_name: 'fresh', new_name: 'renamed', value: 'https://example/fresh.png'});
			expect(await slackCache.getEmojis()).toEqual({renamed: 'https://example/fresh.png'});
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
})
