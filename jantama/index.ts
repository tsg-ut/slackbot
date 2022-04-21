import {stripIndent} from 'common-tags';
import type {FastifyPluginCallback} from 'fastify';
import plugin from 'fastify-plugin';
import {google} from 'googleapis';
import {zip} from 'lodash';
import {Rating, rate} from 'ts-trueskill';
import type {SlackInterface, SlashCommandEndpoint} from '../lib/slack';
import State from '../lib/state';
import {extractMajsoulId, getMajsoulResult} from './util';
import type {Player} from './util';

const BATTLE_LOG_ID = '1Ku67kvpt0oP6PZL7F_6AreQLiiuLq8k8P0qEDCcIqXI';

interface RatingChange {
	player: Player,
	oldRating: number,
	newRating: number,
}

interface UserEntry {
	jantama: string,
	slack: string,
}

interface StateObj {
	users: UserEntry[],
}

const getSlackMentionOrNickname = (accountId: string, nickname: string, users: UserEntry[]) => {
	const user = users.find((user) => user.jantama === accountId);
	if (!user) {
		return nickname;
	}
	return `<@${user.slack}>`;
};

const getPlayerText = (player: Player, users: UserEntry[]) => (
	getSlackMentionOrNickname(player.accountId.toString(), player.nickname, users)
);

const getResultText = (players: Player[], users: UserEntry[]) => {
	const lines = players.map((player, i) => {
		const scoreText = player.score.toLocaleString('en-US');
		const pointText = (player.point > 0 ? '+' : '') + (player.point / 1000).toLocaleString('en-US', {minimumFractionDigits: 1});
		return `*#${i + 1}* ${getPlayerText(player, users)}: ${scoreText} (${pointText})`;
	});
	return lines.join('\n');
};

const getRatingChangeText = (ratingChanges: RatingChange[], users: UserEntry[]) => {
	const lines = ratingChanges.map((ratingChange, i) => {
		const newRating = ratingChange.newRating.toFixed(2);
		const ratingDiff = ratingChange.newRating - ratingChange.oldRating;
		const ratingDiffText = ratingDiff.toFixed(2);
		return `*#${i + 1}* ${getPlayerText(ratingChange.player, users)}: ${newRating} (${ratingDiff > 0 ? '+' : ''}${ratingDiffText})`;
	});
	return lines.join('\n');
};

const getRecordedPaipuIds = async () => {
	const auth = await new google.auth.GoogleAuth({
		scopes: ['https://www.googleapis.com/auth/spreadsheets'],
	}).getClient();
	const sheets = google.sheets({version: 'v4', auth});

	const sheetsData = await new Promise<string[][]>((resolve, reject) => {
		sheets.spreadsheets.values.get({
			spreadsheetId: BATTLE_LOG_ID,
			range: 'log!B:B',
		}, (error, response) => {
			if (error) {
				reject(error);
			} else if (response.data.values) {
				resolve(response.data.values as string[][]);
			} else {
				reject(new Error('values not found'));
			}
		});
	});

	return new Set(sheetsData.slice(1).map(([paipuId]) => paipuId));
};

const generateRatingsFromHistory = async () => {
	const auth = await new google.auth.GoogleAuth({
		scopes: ['https://www.googleapis.com/auth/spreadsheets'],
	}).getClient();
	const sheets = google.sheets({version: 'v4', auth});

	const sheetsData = await new Promise<string[][]>((resolve, reject) => {
		sheets.spreadsheets.values.get({
			spreadsheetId: BATTLE_LOG_ID,
			range: 'log!A:N',
		}, (error, response) => {
			if (error) {
				reject(error);
			} else if (response.data.values) {
				resolve(response.data.values as string[][]);
			} else {
				reject(new Error('values not found'));
			}
		});
	});

	const ratings = new Map<string, Rating>();
	const nicknameMap = new Map<string, string>();

	for (const cells of sheetsData.slice(1)) {
		const users = [cells[3], cells[6], cells[9], cells[12]];
		const nicknames = [cells[2], cells[5], cells[8], cells[11]];

		for (const [user, nickname] of zip(users, nicknames)) {
			nicknameMap.set(user, nickname);
		}

		for (const user of users) {
			if (!ratings.has(user)) {
				ratings.set(user, new Rating());
			}
		}

		const newRatings = rate(users.map((user) => [ratings.get(user)]));
		for (const [user, [newRating]] of zip(users, newRatings)) {
			ratings.set(user, newRating);
		}
	}

	return {ratings, nicknames: nicknameMap};
};

const appendResultToHistory = async (paipuId: string, date: Date, players: Player[]) => {
	const auth = await new google.auth.GoogleAuth({
		scopes: ['https://www.googleapis.com/auth/spreadsheets'],
	}).getClient();
	const sheets = google.sheets({version: 'v4', auth});

	await new Promise<any>((resolve, reject) => {
		sheets.spreadsheets.values.append({
			spreadsheetId: BATTLE_LOG_ID,
			range: 'log!A:N',
			insertDataOption: 'INSERT_ROWS',
			valueInputOption: 'USER_ENTERED',
			requestBody: {
				range: 'log!A:N',
				majorDimension: 'ROWS',
				values: [[
					date.toISOString(),
					`=HYPERLINK("https://game.mahjongsoul.com/?paipu=${paipuId}", "${paipuId}")`,
					...players.flatMap((player) => [
						player.nickname,
						player.accountId.toString(),
						player.score.toString(),
					]),
				]],
			},
		}, (error, response) => {
			if (error) {
				reject(error);
			} else {
				resolve(response);
			}
		});
	});
};

const calculateNewRating = async (players: Player[]) => {
	// 麻雀ログの変更を適用するため、追加のたびに履歴を取得して最初から計算する
	const {ratings: oldRatings} = await generateRatingsFromHistory();

	for (const player of players) {
		if (!oldRatings.has(player.accountId.toString())) {
			oldRatings.set(player.accountId.toString(), new Rating());
		}
	}

	const newRatings = rate(players.map((player) => [oldRatings.get(player.accountId.toString())]));
	const ratingChanges: RatingChange[] = [];
	for (const [player, [newRating]] of zip(players, newRatings)) {
		const oldRating = oldRatings.get(player.accountId.toString());
		ratingChanges.push({
			player,
			oldRating: oldRating.mu - oldRating.sigma * 3,
			newRating: newRating.mu - newRating.sigma * 3,
		});
	}

	return ratingChanges;
};

export const server = async ({webClient: slack}: SlackInterface) => {
	const state = await State.init<StateObj>('jantama', {
		users: [],
	});

	const callback: FastifyPluginCallback = (fastify, opts, next) => {
		fastify.post<SlashCommandEndpoint>('/slash/jantama', async (req, res) => {
			if (req.body.token !== process.env.SLACK_VERIFICATION_TOKEN) {
				res.code(400);
				return 'Bad Request';
			}

			if (req.body.text === '') {
				return {
					response_type: 'in_channel',
					text: stripIndent`
						:ichihime:使い方だにゃ！
						* \`/jantama\` - ヘルプを表示するにゃ！
						* \`/jantama ranking\` - TSG麻雀ランキングを表示するにゃ！
						* \`/jantama [牌譜URL]\` - 牌譜を記録するにゃ！
						* \`/jantama [ユーザーID]\` - Slack連携を設定するにゃ！
					`,
				};
			}

			if (req.body.text === 'ranking') {
				const {ratings, nicknames} = await generateRatingsFromHistory();
				// eslint-disable-next-line array-plural/array-plural
				const ranking = Array.from(ratings.entries()).map(([user, rating]) => ({
					accountId: user,
					nickname: nicknames.get(user),
					rating: rating.mu - rating.sigma * 3,
				}));
				ranking.sort((a, b) => b.rating - a.rating);

				await slack.chat.postMessage({
					channel: req.body.channel_id,
					username: 'jantama',
					icon_emoji: ':ichihime:',
					text: 'TSG麻雀ランキングだにゃ！',
					attachments: ranking.map((rank, i) => ({
						title: `#${i + 1}: ${getSlackMentionOrNickname(rank.accountId, rank.nickname, state.users)} (${rank.rating.toFixed(2)})`,
					})),
				});
				return '';
			}

			if (req.body.text.match(/^\d+$/)) {
				const slackId = req.body.user_id;
				const jantamaId = req.body.text;

				if (state.users.some(({slack}) => slackId === slack)) {
					state.users = state.users.map((user) => user.slack === slackId ? {
						slack: slackId,
						jantama: jantamaId,
					} : user);
				} else {
					state.users.push({slack: slackId, jantama: jantamaId});
				}

				return {
					response_type: 'in_channel',
					text: ':ichihime:連携を設定したにゃ！',
				};
			}

			const paipuId = extractMajsoulId(req.body.text);
			if (paipuId === null) {
				return ':ichihime:牌譜URLが見つからなかったにゃ⋯⋯';
			}

			const recordedPaipuIds = await getRecordedPaipuIds();
			if (recordedPaipuIds.has(paipuId)) {
				return ':ichihime:その牌譜はすでに登録されているにゃ！';
			}

			const {players, date} = await getMajsoulResult(paipuId);
			if (players === null) {
				return ':ichihime:牌譜が見つからなかったにゃ⋯⋯';
			}

			const ratingChanges = await calculateNewRating(players);
			await appendResultToHistory(paipuId, date, players);

			await slack.chat.postMessage({
				channel: req.body.channel_id,
				username: 'jantama',
				icon_emoji: ':ichihime:',
				text: '',
				blocks: [
					{
						type: 'section',
						text: {
							type: 'mrkdwn',
							text: '対戦結果を記録したにゃ！\n牌譜ID: <https://game.mahjongsoul.com/?paipu=220217-340f8623-e1e4-4b52-b52d-5705331fe1fa|220217-340f8623-e1e4-4b52-b52d-5705331fe1fa>',
						},
					},
					{
						type: 'header',
						text: {
							type: 'plain_text',
							text: '対戦結果',
							emoji: true,
						},
					},
					{
						type: 'section',
						text: {
							type: 'mrkdwn',
							text: getResultText(players, state.users),
						},
					},
					{
						type: 'divider',
					},
					{
						type: 'header',
						text: {
							type: 'plain_text',
							text: 'TSG麻雀レート',
							emoji: true,
						},
					},
					{
						type: 'section',
						text: {
							type: 'mrkdwn',
							text: getRatingChangeText(ratingChanges, state.users),
						},
					},
					{
						type: 'divider',
					},
					{
						type: 'section',
						text: {
							type: 'mrkdwn',
							text: `Slackアカウントを登録するには、<https://docs.google.com/spreadsheets/d/${BATTLE_LOG_ID}|対戦ログ>を確認して \`/jantama [自分のID]\` と入力するにゃ！`,
						},
					},
				],
			});

			return 'ok';
		});

		next();
	};

	return plugin(callback);
};
