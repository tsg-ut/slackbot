import plugin from 'fastify-plugin';
import {Mutex} from 'async-mutex';
import {stripIndent} from 'common-tags';
import moment from 'moment';
import {SlackInterface, SlashCommandEndpoint} from '../lib/slack';
import {getMemberIcon, getMemberName, mrkdwn} from '../lib/slackUtils';
import logger from '../lib/logger';
import State from '../lib/state';
import config from './config';
import * as views from './views';
import * as atcoder from './atcoder';
import {MessageAttachment} from '@slack/web-api';

const USERNAME = 'golfbot';
const ICON_EMOJI = ':golf:';

const mutex = new Mutex();

type ParseResult =
	| {
			type: 'none';
	  }
	| {
			type: 'error';
			message: string;
			subcommand?: string;
	  }
	| {
			type: 'help';
			subcommand?: string;
	  }
	| {
			type: 'join';
			service: string;
			username: string;
	  }
	| {
			type: 'post';
	  }
	| {
			type: 'remove';
			messageTs: string;
	  };

const parseMessage = (text: string): ParseResult | null => {
	let re: RegExp;
	let match: RegExpMatchArray | null;

	// call
	re = /^@golfbot\b\s*/;
	match = re.exec(text);
	if (!match) return null;
	text = text.replace(re, '');

	// subcommand
	re = /^(?<subcommand>[a-z0-9-]+)\b\s*/i;
	match = re.exec(text);
	if (!match) return {type: 'none'};
	const {subcommand} = match.groups!;
	text = text.replace(re, '');

	switch (subcommand) {
		case 'join': {
			re = /^(?<service>atcoder)\s+(?<username>[a-z0-9-]+)\s*$/i;
			match = re.exec(text);
			if (!match) {
				return {type: 'error', message: `引数がおかしいよ`, subcommand: 'join'};
			}
			const {service, username} = match.groups!;
			return {type: 'join', service, username};
		}
		case 'post': {
			return {type: 'post'};
		}
		case 'remove': {
			re = /^(?<messageTs>[0-9.]+)\s*$/i;
			match = re.exec(text);
			if (!match) {
				return {type: 'error', message: `引数がおかしいよ`, subcommand: 'remove'};
			}
			const {messageTs} = match.groups!;
			return {type: 'remove', messageTs};
		}
		case 'help': {
			re = /^(?<subcommand>[a-z0-9-]+)\s*$/i;
			match = re.exec(text);
			if (!match) {
				return {type: 'help'};
			}
			const {subcommand} = match.groups!;
			return {type: 'help', subcommand};
		}
		default: {
			return {
				type: 'error',
				message: `「${subcommand}」は知らないコマンドだよ`,
			};
		}
	}
};

const help = (subcommand?: string): string => {
	switch (subcommand) {
		case 'join': {
			return stripIndent`
				\`join\` : アカウント登録

				\`\`\`
				@golfbot join atcoder <username>
				\`\`\`
			`;
		}
		case 'post': {
			return stripIndent`
				\`post\` : 問題投稿 (スラッシュコマンド)

				\`\`\`
				/golfbot post
				\`\`\`

				ダイアログが開くので、問題 URL、開始日時、終了日時を入力してね！
			`;
		}
		default: {
			return stripIndent`
				\`join\` : アカウント登録
				\`post\` : 問題投稿 (スラッシュコマンド)

				詳しい使い方は \`@golfbot help <subcommand>\` で聞いてね！
			`;
		}
	}
};

interface StateObj {
	users: User[];
	contests: Contest[];
}

interface User {
	slackId: string;
	atcoderId: string;
}

interface Contest {
	owner: string;
	messageTs: string;
	problem: Problem;
	startAt: number;
	endAt: number;
	submissions: Submission[];
}

type Problem = AtCoderProblem;

interface AtCoderProblem {
	service: 'atcoder';
	url: string;
	contestId: string;
	taskId: string;
	language: string;
}

type Submission = atcoder.Submission;

const formatContestTime = (contest: Contest): string => {
	const start = moment(contest.startAt)
		.locale('ja')
		.format('YYYY-MM-DD (ddd) HH:mm');
	const end = moment(contest.endAt).format('HH:mm');
	const duration = Math.floor((contest.endAt - contest.startAt) / (60 * 1000));
	return `${start} ～ ${end} (${duration}分)`;
};

export const server = ({rtmClient: rtm, webClient: slack, messageClient: slackInteractions}: SlackInterface) =>
	plugin(async fastify => {
		const state = await State.init<StateObj>('golfbot', {
			users: [],
			contests: [],
		});

		// メッセージ
		rtm.on('message', async (message: any) => {
			const cmd = parseMessage(message.text);
			if (cmd === null) {
				return;
			}

			logger.info(`[golfbot] command ${JSON.stringify(cmd)}`);

			switch (cmd.type) {
				case 'join': {
					const user = state.users.find(u => u.slackId === message.user);
					if (user) {
						user.atcoderId = cmd.username;
					} else {
						state.users.push({
							slackId: message.user,
							atcoderId: cmd.username,
						});
					}
					await slack.reactions.add({
						name: '+1',
						channel: message.channel,
						timestamp: message.ts,
					});
					return;
				}
				case 'post': {
					await slack.chat.postMessage({
						username: USERNAME,
						icon_emoji: ICON_EMOJI,
						channel: message.channel,
						text: help('help'),
					});
					return;
				}
				case 'remove': {
					state.contests = state.contests.filter(c => c.messageTs !== cmd.messageTs);

					await slack.reactions.add({
						name: '+1',
						channel: message.channel,
						timestamp: message.ts,
					});

					await slack.chat.postMessage({
						username: USERNAME,
						icon_emoji: ICON_EMOJI,
						channel: process.env.CHANNEL_SIG_CODEGOLF!,
						text: stripIndent`
							コンテストが削除されたよ :cry:
						`,
					});
					return;
				}
				case 'help': {
					await slack.chat.postMessage({
						username: USERNAME,
						icon_emoji: ICON_EMOJI,
						channel: message.channel,
						text: help(cmd.subcommand),
					});
					return;
				}
				case 'error': {
					await slack.chat.postMessage({
						username: USERNAME,
						icon_emoji: ICON_EMOJI,
						channel: message.channel,
						text: cmd.message + '\n---\n' + help(cmd.subcommand),
					});
					return;
				}
				case 'none': {
					await slack.chat.postMessage({
						username: USERNAME,
						icon_emoji: ICON_EMOJI,
						channel: message.channel,
						text: help(),
					});
					return;
				}
			}
		});

		const {team: tsgTeam}: any = await slack.team.info();
		fastify.post<SlashCommandEndpoint>('/slash/golfbot', async (request, response) => {
			if (request.body.token !== process.env.SLACK_VERIFICATION_TOKEN) {
				response.code(400);
				return 'Bad Request';
			}
			if (request.body.team_id !== tsgTeam.id) {
				response.code(200);
				return '/golfbot is only for TSG. Sorry!';
			}

			if (/^\s*post\s*$/.test(request.body.text)) {
				await slack.views.open({
					trigger_id: request.body.trigger_id,
					view: views.createPostView(),
				});
				return '';
			} else {
				return help('post');
			}
		});

		// 問題編集ボタン呼び出し
		slackInteractions.action(
			{
				blockId: 'golfbot_edit',
				actionId: 'edit',
			},
			(payload: any) => {
				mutex.runExclusive(async () => {
					const contest = state.contests.find(c => c.messageTs === payload.container.message_ts);
					if (!contest) {
						return;
					}
					await slack.views.open({
						trigger_id: payload.trigger_id,
						view: {
							...views.createPostView({
								problemURL: contest.problem.url,
								language: contest.problem.language,
								date: moment(contest.startAt).format('YYYY-MM-DD'),
								startTime: moment(contest.startAt).format('HH:mm'),
								endTime: moment(contest.endAt).format('HH:mm'),
							}),
							private_metadata: contest.messageTs,
						},
					});
				});
			}
		);

		// 問題投稿
		slackInteractions.viewSubmission(
			{
				callbackId: 'golfbot_post',
			},
			(payload: any) => {
				const values = views.getPostValues(payload.view.state.values);

				const now = Date.now();
				const today = moment(now).format('YYYY-MM-DD');
				const startAt = new Date(`${values.date} ${values.startTime}`).getTime();
				const endAt = new Date(`${values.date} ${values.endTime}`).getTime();

				if (values.date < today) {
					return {
						response_action: 'errors',
						errors: {
							golfbot_post_date: '過去の日付は選べないよ',
						},
					};
				}

				if (startAt < now) {
					return {
						response_action: 'errors',
						errors: {
							golfbot_post_start_time: '開始時刻は過去にできないよ',
						},
					};
				}

				if (startAt >= endAt) {
					return {
						response_action: 'errors',
						errors: {
							golfbot_post_end_time: '終了時刻は開始時刻より後にしてね',
						},
					};
				}

				const re = /^https:\/\/atcoder\.jp\/contests\/(?<contestId>[a-z0-9_-]+)\/tasks\/(?<taskId>[a-z0-9_-]+)$/i;
				const match = re.exec(values.problemURL);
				if (!match) {
					return {
						response_action: 'errors',
						errors: {
							golfbot_post_problem_url: '問題 URL がおかしいよ',
						},
					};
				}
				const {contestId, taskId} = match.groups!;

				const messageTs = payload.view.private_metadata;
				if (messageTs) {
					// コンテストを編集
					logger.info(`[golfbot] edit ${JSON.stringify(values)}`);

					mutex.runExclusive(async () => {
						const contest: Contest = {
							owner: payload.user.id,
							messageTs,
							problem: {
								service: 'atcoder',
								url: values.problemURL,
								contestId,
								taskId,
								language: values.language,
							},
							startAt,
							endAt,
							submissions: [],
						};

						const oldContest = state.contests.find(c => (c.messageTs === contest.messageTs ? contest : c));
						if (!oldContest) {
							return;
						}

						// DM を更新
						const {channel}: any = await slack.conversations.open({
							users: payload.user.id,
						});
						await slack.chat.update({
							channel: channel.id,
							ts: messageTs,
							text: '',
							attachments: [
								{
									fields: [
										{title: '問題', value: contest.problem.url},
										{title: '言語', value: config.atcoder.languages.find(l => l.id === values.language)?.name ?? ''},
										{title: 'コンテスト時間', value: formatContestTime(contest)},
									],
								},
							],
						});

						state.contests = state.contests.map(c => (c.messageTs === contest.messageTs ? contest : c));

						// #sig-codegolf に送る
						await slack.chat.postMessage({
							username: USERNAME,
							icon_emoji: ICON_EMOJI,
							channel: process.env.CHANNEL_SIG_CODEGOLF!,
							text: stripIndent`
								コンテストが変更されたよ！
							`,
							attachments: [
								{
									fields: [
										{title: '投稿者', value: `<@${payload.user.id}>`},
										{title: '形式', value: 'AtCoder'},
										{title: '言語', value: config.atcoder.languages.find(l => l.id === values.language)?.name ?? ''},
										{title: 'コンテスト時間', value: formatContestTime(contest)},
									],
								},
							],
						});
					});
				} else {
					// コンテストを追加
					logger.info(`[golfbot] post ${JSON.stringify(values)}`);

					mutex.runExclusive(async () => {
						const contest: Contest = {
							owner: payload.user.id,
							messageTs: '',
							problem: {
								service: 'atcoder',
								url: values.problemURL,
								contestId,
								taskId,
								language: values.language,
							},
							startAt,
							endAt,
							submissions: [],
						};

						// DM を送る
						const {channel}: any = await slack.conversations.open({
							users: payload.user.id,
						});
						const message: any = await slack.chat.postMessage({
							username: USERNAME,
							icon_emoji: ICON_EMOJI,
							channel: channel.id,
							text: '',
							blocks: [
								{
									type: 'section',
									text: mrkdwn(stripIndent`
										コンテストを追加したよ！
										内容を編集するにはこのボタンを使ってね！
										このコンテストを削除するには \`@golfbot remove ${messageTs}\` と送ってね！
									`),
								},
								...views.createEditBlocks(),
							],
							attachments: [
								{
									fields: [
										{title: '問題', value: contest.problem.url},
										{title: '言語', value: config.atcoder.languages.find(l => l.id === values.language)?.name ?? ''},
										{title: 'コンテスト時間', value: formatContestTime(contest)},
									],
								},
							],
						});

						contest.messageTs = message.ts;
						state.contests.push(contest);

						// #sig-codegolf に送る
						await slack.chat.postMessage({
							username: USERNAME,
							icon_emoji: ICON_EMOJI,
							channel: process.env.CHANNEL_SIG_CODEGOLF!,
							text: stripIndent`
								コンテストが追加されたよ！
							`,
							attachments: [
								{
									fields: [
										{title: '投稿者', value: `<@${payload.user.id}>`},
										{title: '形式', value: 'AtCoder'},
										{title: '言語', value: config.atcoder.languages.find(l => l.id === values.language)?.name ?? ''},
										{title: 'コンテスト時間', value: formatContestTime(contest)},
									],
								},
							],
						});
					});
				}

				return {
					response_action: 'clear',
				};
			}
		);

		// 5 秒ごとに開始判定
		{
			let time = Date.now();
			setInterval(() => {
				const oldTime = time;
				const newTime = Date.now();
				time = newTime;

				mutex.runExclusive(async () => {
					for (const contest of state.contests) {
						// ちょうど開始のコンテスト
						if (oldTime < contest.startAt && contest.startAt <= newTime) {
							await slack.chat.postMessage({
								username: USERNAME,
								icon_emoji: ICON_EMOJI,
								channel: process.env.CHANNEL_SIG_CODEGOLF!,
								text: stripIndent`
									コンテストが始まったよ～ :golfer:
								`,
								attachments: [
									{
										fields: [
											{title: '投稿者', value: `<@${contest.owner}>`},
											{title: '問題', value: contest.problem.url},
											{title: '言語', value: config.atcoder.languages.find(l => l.id === contest.problem.language)?.name ?? '', short: true},
											{title: 'コンテスト時間', value: formatContestTime(contest)},
										],
									},
								],
							});
						}
					}
				});
			}, 5 * 1000);
		}

		// 30 秒ごとに提出判定、その後終了判定
		{
			let time = Date.now();
			setInterval(() => {
				const oldTime = time;
				const newTime = Date.now();
				time = newTime;

				mutex.runExclusive(async () => {
					for (const contest of state.contests) {
						// 開催中、またはちょうど終了のコンテスト
						if (contest.startAt <= newTime && oldTime < contest.endAt) {
							const getShortests = (submissions: Submission[]) => {
								const shortests = new Map<string, number>();
								for (const {userId, length} of submissions) {
									if (!shortests.has(userId) || shortests.get(userId)! > length) {
										shortests.set(userId, length);
									}
								}
								return shortests;
							};

							const oldShortests = getShortests(contest.submissions);

							const newSubmissions = await atcoder.crawlSubmissions(contest.problem.contestId, {
								language: contest.problem.language,
								status: 'AC',
								task: contest.problem.taskId,
								since: new Date(contest.startAt),
								until: new Date(contest.endAt),
							});

							const newShortests = getShortests(newSubmissions);
							for (const [atcoderId, newLength] of newShortests.entries()) {
								if (oldShortests.has(atcoderId) && oldShortests.get(atcoderId)! <= newLength) {
									continue;
								}

								const user = state.users.find(u => u.atcoderId === atcoderId);
								if (!user) {
									continue;
								}
								await slack.chat.postMessage({
									username: USERNAME,
									icon_emoji: ICON_EMOJI,
									channel: process.env.CHANNEL_SIG_CODEGOLF!,
									text: oldShortests.has(atcoderId)
										? stripIndent`
											<@${user.slackId}> がコードを短縮しました！
											${oldShortests.get(atcoderId)!} Byte → ${newLength} Byte
										`
										: stripIndent`
											<@${user.slackId}> が :ac: しました！
											${newLength} Byte
										`,
								});
							}

							contest.submissions = newSubmissions;
						}

						// ちょうど終了のコンテスト
						if (oldTime < contest.endAt && contest.endAt <= newTime) {
							const standings = atcoder.computeStandings(contest.submissions);

							const sourceCodes = new Map<string, string>();
							for (const {userId, submission} of standings) {
								const code = await atcoder.crawlSourceCode(contest.problem.contestId, submission.id);
								sourceCodes.set(userId, code);
							}

							const attachments: MessageAttachment[] = [];
							for (const {userId: atcoderId, submission} of standings) {
								const user = state.users.find(u => u.atcoderId === atcoderId);
								if (!user) {
									continue;
								}

								const code = await atcoder.crawlSourceCode(contest.problem.contestId, submission.id);

								attachments.push({
									mrkdwn_in: ['text'],
									author_name: `${await getMemberName(user.slackId)}: ${submission.length} Byte`,
									author_icon: await getMemberIcon(user.slackId),
									author_link: `https://atcoder.jp/contests/${contest.problem.contestId}/submissions/${submission.id}`,
									text: `\`\`\`${code}\`\`\``,
									footer: `提出: ${moment(submission.time).format('HH:mm:ss')}`,
								});
							}

							await slack.chat.postMessage({
								username: USERNAME,
								icon_emoji: ICON_EMOJI,
								channel: process.env.CHANNEL_SIG_CODEGOLF!,
								text: stripIndent`
									お疲れさまでした！

									${standings.length === 0 ? '今回は :ac: した人がいなかったよ :cry:' : ''}
								`,
								attachments,
							});
						}
					}

					// 終了したコンテストを削除
					state.contests = state.contests.filter(contest => !(contest.endAt <= newTime));
				});
			}, 30 * 1000);
		}
	});
