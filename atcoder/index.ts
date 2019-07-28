import {promises as fs, constants} from 'fs';
import path from 'path';
import axios from 'axios';
// @ts-ignore
import schedule from 'node-schedule';
// @ts-ignore
import {stripIndent} from 'common-tags';
import {getMemberIcon, getMemberName} from '../lib/slackUtils';
import {SlackInterface, Standings, Results} from './types';

const getRatingColor = (rating: number | null) => {
	// gray
	if (rating === null || rating < 400) {
		return '#808080';
	}

	// brown
	if (rating < 800) {
		return '#804000';
	}

	// green
	if (rating < 1200) {
		return '#008000';
	}

	// cyan
	if (rating < 1600) {
		return '#00C0C0';
	}

	// blue
	if (rating < 2000) {
		return '#0000FF';
	}

	// yellow
	if (rating < 2400) {
		return '#C0C000';
	}

	// orange
	if (rating < 2800) {
		return '#FF8000';
	}

	// red
	if (rating < 3200) {
		return '#FF0000';
	}

	// ???
	return '#000000';
};

const formatTime = (seconds: number) => (
	`${Math.floor(seconds / 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`
);

const formatNumber = (number: number) => {
	if (number === 0) {
		return '0';
	}
	if (number > 0) {
		return `+${number}`;
	}
	return number.toString();
}

export default async ({rtmClient: rtm, webClient: slack}: SlackInterface) => {
	const statePath = path.resolve(__dirname, 'state.json');
	const exists = await fs.access(statePath, constants.F_OK).then(() => true).catch(() => false);
	const state = Object.assign({
		users: [] as {atcoder: string, slack: string}[],
		contests: [] as {id: string, startTime: number}[],
	}, exists ? await fs.readFile(statePath) : {})

	const prepost = async () => {
		const {data: standings}: {data: Standings} = await axios.get('https://atcoder.jp/contests/abc135/standings/json');
		const hakatashi = standings.StandingsData.find(({UserName}) => UserName === 'hakatashi');
		const tasks = new Map(standings.TaskInfo.map((task) => [task.TaskScreenName, task]));
		slack.chat.postMessage({
			username: 'atcoder',
			icon_emoji: ':computer:',
			channel: 'C138GLKMW',
			text: stripIndent`
				*AtCoder Beginner Contest 135* お疲れさまでした！
				※このランキングに掲出して欲しい人は「@atcoder [atcoderユーザー名]」と書き込んでね:star:
			`,
			attachments: [
				{
					color: '#00C0C0',
					author_name: `@hakatashi: ${hakatashi.Rank}位 (暫定)`,
					author_icon: await getMemberIcon('U04G7TL4P'),
					text: Object.entries(hakatashi.TaskResults).filter(([, task]) => task.Status === 1).map(([id]) => `[${tasks.get(id).Assignment}]`).join(' '),
				},
			],
		});
	};

	let isPosted = false;
	const post = async () => {
		if (isPosted) {
			return;
		}
		// const {data: results}: {data: Results} = await axios.get('https://atcoder.jp/contests/abc135/results/json');
		const results: Results = require('../results.json');
		if (results.length === 0) {
			return;
		}
		isPosted = true;
		const userResults = state.users.map(({atcoder, slack}) => {
			const result = results.find(({UserName, UserScreenName}) => UserName === atcoder || UserScreenName === atcoder);
			return {user: slack, result};
		}).sort((a, b) => (a.result ? a.result.Place : 1e9) - (b.result ? b.result.Place : 1e9));
		// const {data: standings}: {data: Standings} = await axios.get('https://atcoder.jp/contests/abc135/standings/json');
		const standings: Standings = require('../standings.json');
		const standingMap = new Map(state.users.map(({atcoder, slack}) => {
			const standing = standings.StandingsData.find(({UserName, UserScreenName}) => UserName === atcoder || UserScreenName === atcoder);
			return [slack, standing];
		}));
		const tasks = new Map(standings.TaskInfo.map((task) => [task.TaskScreenName, task]));
		slack.chat.postMessage({
			username: 'atcoder',
			icon_emoji: ':atcoder:',
			channel: process.env.CHANNEL_SANDBOX,
			text: stripIndent`
				※テストだよ
				*AtCoder Beginner Contest 135* の順位が確定したよ～:checkered_flag:
			`,
			attachments: [
				...(await Promise.all(userResults.map(async ({user, result}) => {
					const stats = result ? [
						{
							title: '得点',
							value: (standingMap.get(user).TotalResult.Score / 100).toString(),
						},
						{
							title: '最終提出',
							value: formatTime(standingMap.get(user).TotalResult.Elapsed / 1000000000),
						},
						...(result.IsRated ? [
							{
								title: 'パフォーマンス',
								value: result.Performance.toString(),
							},
							{
								title: 'レーティング変動',
								value: `${formatNumber(result.NewRating - result.OldRating)} (${result.OldRating} → ${result.NewRating})`,
							},
						] : [])
					] : [];

					return {
						color: getRatingColor(result ? result.NewRating : null),
						author_name: `${await getMemberName(user)}: ${result ? `${result.Place}位` : '不参加'}`,
						author_icon: await getMemberIcon(user),
						text: result ? [
							Object.entries(standingMap.get(user).TaskResults).filter(([, task]) => task.Status === 1).map(([id, task]) => `[ *${tasks.get(id).Assignment}*${task.Penalty ? ` (${task.Penalty})` : ''} ]`).join(' '),
							stats.map(({title, value}) => `*${title}* ${value}`).join(', '),
						].join('\n') : '',
					};
				}))),
				{
					text: '********************\n※このランキングに掲出して欲しい人は「@atcoder [atcoderユーザー名]」と書き込んでね',
					color: '#FB8C00',
				},
			],
		});
	}

	setInterval(() => {
		post();
	}, 30 * 1000);
	post();

	schedule.scheduleJob('40 22 * * *', () => {
		prepost();
	});
};
