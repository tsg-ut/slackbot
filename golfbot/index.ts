import {Mutex} from 'async-mutex';
import {stripIndent} from 'common-tags';
import moment from 'moment';
import {SlackInterface} from '../lib/slack';
import logger from '../lib/logger';
import State from '../lib/state';
import config from './config';
import * as views from './views';
import * as atcoder from './atcoder';

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
			return {type: 'error', message: `「${subcommand}」は知らないコマンドだよ`};
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
				\`post\` : 問題投稿

				\`\`\`
				@golfbot post
				\`\`\`

				ダイアログが開くので、問題 URL、開始日時、終了日時を入力してね！
			`;
		}
		default: {
			return stripIndent`
				\`join\` : アカウント登録
				\`post\` : 問題投稿

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
	slack: string;
	atcoder: string;
}

interface Contest {
	owner: string;
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

export default async ({rtmClient: rtm, webClient: slack, messageClient: slackInteractions}: SlackInterface) => {
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
				return;
			}
			case 'post': {
				await slack.chat.postMessage({
					username: USERNAME,
					icon_emoji: ICON_EMOJI,
					channel: message.channel,
					text: '',
					blocks: views.createPostBlocks(),
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

	// 問題投稿ボタン呼び出し
	slackInteractions.action(
		{
			blockId: 'golfbot_post',
			actionId: 'post',
		},
		(payload: any) => {
			mutex.runExclusive(() => {
				slack.views.open({
					trigger_id: payload.trigger_id,
					view: views.createPostView(),
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

			logger.info(`[golfbot] post ${JSON.stringify(values)}`);

			mutex.runExclusive(async () => {
				state.contests.push({
					owner: payload.user.id,
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
				});
				await slack.chat.postMessage({
					username: USERNAME,
					icon_emoji: ICON_EMOJI,
					channel: process.env.CHANNEL_SIG_CODEGOLF!,
					text: stripIndent`
						??? が問題を追加したよ！

						問題: ひみつ
						言語: ひみつ
						開始日時: ${moment(startAt).format('YYYY-MM-DD HH:mm')}
						終了日時: ${moment(endAt).format('YYYY-MM-DD HH:mm')}
					`,
				});
			});

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
					if (oldTime <= contest.startAt && contest.startAt < newTime) {
						await slack.chat.postMessage({
							username: USERNAME,
							icon_emoji: ICON_EMOJI,
							channel: process.env.CHANNEL_SIG_CODEGOLF!,
							text: stripIndent`
							コンテストが始まったよ～ :golfer:

							投稿者: <@${contest.owner}>
							問題: ${contest.problem.url}
							言語: ${config.atcoder.languages.find(l => l.id === contest.problem.language)?.name}
							開始日時: ${moment(contest.startAt).format('YYYY-MM-DD HH:mm')}
							終了日時: ${moment(contest.endAt).format('YYYY-MM-DD HH:mm')}
						`,
						});
					}
					// ちょうど終了のコンテスト
					if (oldTime <= contest.endAt && contest.endAt < newTime) {
						await slack.chat.postMessage({
							username: USERNAME,
							icon_emoji: ICON_EMOJI,
							channel: process.env.CHANNEL_SIG_CODEGOLF!,
							text: stripIndent`
								お疲れさまでした！
							`,
						});
					}
				}
			});
		}, 5 * 1000);
	}

	// 30 秒ごとに提出判定
	{
		let time = Date.now();
		setInterval(() => {
			const oldTime = time;
			const newTime = Date.now();
			time = newTime;

			mutex.runExclusive(async () => {
				for (const contest of state.contests) {
					// 開催中のコンテスト
					if (contest.startAt <= newTime && newTime < contest.endAt) {
						const updates = new Map<string, {from: number; to: number}>();

						const crawledSubmissions = await atcoder.crawlSubmissions(contest.problem.contestId, {
							language: contest.problem.language,
							status: 'AC',
							task: contest.problem.taskId,
							since: new Date(oldTime),
						});
						for (const submission of crawledSubmissions) {
							const user = state.users.find(u => u.atcoder === submission.userId);
							if (!user) {
								continue;
							}
							const userSubmissions = contest.submissions.filter(s => s.userId === user.slack);
							const oldShortest = Math.min(...userSubmissions.map(s => s.length));
							if (submission.length < oldShortest) {
								const from = updates.get(user.slack)?.from ?? oldShortest;
								updates.set(user.slack, {from, to: submission.length});
							}
							contest.submissions.push(submission);
						}
						for (const [slackId, {from, to}] of updates.entries()) {
							await slack.chat.postMessage({
								username: USERNAME,
								icon_emoji: ICON_EMOJI,
								channel: process.env.CHANNEL_SIG_CODEGOLF!,
								text: Number.isFinite(from)
									? stripIndent`
										<@${slackId}> がコードを短縮しました！
										${from} Byte → ${to} Byte
									`
									: stripIndent`
										<@${slackId}> が :ac: しました！
										${to} Byte
									`,
							});
						}
					}
				}
			});
		}, 30 * 1000);
	}
};
