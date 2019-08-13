import {promises as fs, constants} from 'fs';
import path from 'path';
import axios from 'axios';
import qs from 'querystring';
// @ts-ignore
import {stripIndent} from 'common-tags';
import scrapeIt from 'scrape-it';
// @ts-ignore
import prime from 'primes-and-factors';
// @ts-ignore
import logger from '../lib/logger.js';
import {getMemberIcon, getMemberName} from '../lib/slackUtils';
import {SlackInterface, Standings, Results} from './types';
import {unlock} from '../achievements';

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

interface State {
	users: {atcoder: string, slack: string}[],
	contests: {id: string, date: number, title: string, duration: number, isPosted: boolean, isPreposted: boolean}[],
}

export default async ({rtmClient: rtm, webClient: slack}: SlackInterface) => {
	const statePath = path.resolve(__dirname, 'state.json');
	const exists = await fs.access(statePath, constants.F_OK).then(() => true).catch(() => false);
	const state: State = Object.assign({
		users: [],
		contests: [],
	}, exists ? JSON.parse((await fs.readFile(statePath)).toString()) : {})

	await fs.writeFile(statePath, JSON.stringify(state));
	const setState = (object: {[key: string]: any}) => {
		Object.assign(state, object);
		return fs.writeFile(statePath, JSON.stringify(state));
	};

	const updateContests = async () => {
		logger.info('Updating AtCoder contests...');
		const {data: html} = await axios.get('https://atcoder.jp/contests/', {
			headers: {
				'Accept-Language': 'ja-JP',
			},
		});
		const {contests}: {contests: {date: number, title: string, id: string, duration: number}[]} = await scrapeIt.scrapeHTML(html, {
			contests: {
				listItem: 'tbody tr',
				data: {
					date: {
						selector: 'td:nth-child(1) time',
						convert: (time) => new Date(time).getTime(),
					},
					title: 'td:nth-child(2)',
					id: {
						selector: 'td:nth-child(2) a',
						attr: 'href',
						convert: (href) => {
							const [, , id = ''] = href.split('/');
							return id;
						},
					},
					duration: {
						selector: 'td:nth-child(3)',
						convert: (text) => {
							const [hours = '', minutes = ''] = text.split(':');
							return ((parseInt(hours) || 0) * 60 + (parseInt(minutes) || 0)) * 60 * 1000;
						},
					},
				},
			},
		});
		logger.info(`Fetched ${contests.length} contests`);
		if (contests.length > 0) {
			const oldContests = state.contests;
			setState({
				contests: contests.filter(({date}: any) => !Number.isNaN(date)).map((contest) => ({
					...contest,
					isPosted: (oldContests.find(({id}) => id === contest.id) || {isPosted: false}).isPosted,
					isPreposted: (oldContests.find(({id}) => id === contest.id) || {isPreposted: false}).isPreposted,
				})),
			});
		}
	};

	const postPreroll = async (id: string) => {
		const contest = state.contests.find((contest) => contest.id === id);
		logger.info(`Posting preroll of contest ${id}...`);

		slack.chat.postMessage({
			username: 'atcoder',
			icon_emoji: ':atcoder:',
			channel: process.env.CHANNEL_PROCON,
			text: stripIndent`
				あと15分で *${contest.title}* が始まるよ！ 準備はいいかな～?
				https://atcoder.jp/contests/${contest.id}
			`,
		});
	};

	const postStart = async (id: string) => {
		const contest = state.contests.find((contest) => contest.id === id);
		logger.info(`Posting start of contest ${id}...`);

		slack.chat.postMessage({
			username: 'atcoder',
			icon_emoji: ':atcoder:',
			channel: process.env.CHANNEL_PROCON,
			text: stripIndent`
				*${contest.title}* が始まったよ～:man-running:
				https://atcoder.jp/contests/${contest.id}
			`,
		});
	};

	const prepostResult = async (id: string) => {
		const contest = state.contests.find((contest) => contest.id === id);

		const {data: {endTime}} = await scrapeIt(`https://atcoder.jp/contests/${id}`, {
			endTime: {
				selector: '.contest-duration a:last-child time',
				convert: (time) => new Date(time).getTime(),
			},
		});
		// Check if the contest is postponed
		if (endTime > contest.date + contest.duration) {
			contest.duration = endTime - contest.date;
			return;
		}

		contest.isPreposted = true;
		logger.info(`Preposting result of contest ${id}...`);

		const {data: standings}: {data: Standings} = await axios.get(`https://atcoder.jp/contests/${id}/standings/json`);

		const userStandings = state.users.map(({atcoder, slack}) => {
			const standing = standings.StandingsData.find(({UserName, UserScreenName}) => UserName === atcoder || UserScreenName === atcoder);
			return {user: slack, atcoder, standing};
		}).sort((a, b) => (a.standing ? a.standing.Rank : 1e9) - (b.standing ? b.standing.Rank : 1e9));
		const tasks = new Map(standings.TaskInfo.map((task) => [task.TaskScreenName, task]));

		await slack.chat.postMessage({
			username: 'atcoder',
			icon_emoji: ':atcoder:',
			channel: process.env.CHANNEL_PROCON,
			text: stripIndent`
				*${contest.title}* お疲れさまでした！
			`,
			attachments: [
				...(await Promise.all(userStandings.map(async ({user, atcoder, standing}) => {
					const score = standing && (standing.TotalResult.Score / 100);
					const lastSubmission = standing && formatTime(standing.TotalResult.Elapsed / 1000000000);

					return {
						color: getRatingColor(standing ? standing.Rating : null),
						author_name: `${await getMemberName(user)}: ${standing ? `${standing.Rank}位 (暫定)` : '不参加'}`,
						author_icon: await getMemberIcon(user),
						author_link: `https://atcoder.jp/contests/${contest.id}/standings?${qs.encode({watching: atcoder})}`,
						text: standing ? Object.entries(standing.TaskResults).filter(([, task]) => task.Status === 1).map(([id, task]) => `[ *${tasks.get(id).Assignment}*${task.Penalty ? ` (${task.Penalty})` : ''} ]`).join(' ') : '',
						footer: standing ? `${score}点 (最終提出: ${lastSubmission})` : '',
					};
				}))),
				{
					text: '――――――――――――\n※このランキングに掲出して欲しい人は「@atcoder [atcoderユーザー名]」と書き込んでね',
					color: '#FB8C00',
				},
			],
		});

		for (const {user} of userStandings) {
			await unlock(user, 'atcoder-participate');
		}
	};

	const postResult = async (id: string) => {
		const contest = state.contests.find((contest) => contest.id === id);

		const {data: results}: {data: Results} = await axios.get(`https://atcoder.jp/contests/${id}/results/json`);
		if (results.length === 0) {
			return;
		}

		contest.isPosted = true;
		logger.info(`Posting result of contest ${id}...`);

		const userResults = state.users.map(({atcoder, slack}) => {
			const result = results.find(({UserName, UserScreenName}) => UserName === atcoder || UserScreenName === atcoder);
			return {user: slack, atcoder, result};
		}).sort((a, b) => (a.result ? a.result.Place : 1e9) - (b.result ? b.result.Place : 1e9));

		const {data: standings}: {data: Standings} = await axios.get(`https://atcoder.jp/contests/${id}/standings/json`);
		const standingMap = new Map(state.users.map(({atcoder, slack}) => {
			const standing = standings.StandingsData.find(({UserName, UserScreenName}) => UserName === atcoder || UserScreenName === atcoder);
			return [slack, standing];
		}));
		const tasks = new Map(standings.TaskInfo.map((task) => [task.TaskScreenName, task]));

		await slack.chat.postMessage({
			username: 'atcoder',
			icon_emoji: ':atcoder:',
			channel: process.env.CHANNEL_PROCON,
			text: stripIndent`
				*${contest.title}* の順位が確定したよ～:checkered_flag:
			`,
			attachments: [
				...(await Promise.all(userResults.map(async ({user, atcoder, result}) => {
					const score = result && standingMap.get(user).TotalResult.Score / 100;
					const lastSubmission = result && formatTime(standingMap.get(user).TotalResult.Elapsed / 1000000000);
					const stats = (result && result.IsRated) ? [
						{
							title: 'パフォーマンス',
							value: result.Performance.toString(),
						},
						{
							title: 'レーティング変動',
							value: `${formatNumber(result.NewRating - result.OldRating)} (${result.OldRating} → ${result.NewRating})`,
						},
					] : [];

					return {
						color: getRatingColor(result ? result.NewRating : null),
						author_name: `${await getMemberName(user)}: ${result ? `${result.Place}位` : '不参加'}`,
						author_icon: await getMemberIcon(user),
						author_link: `https://atcoder.jp/contests/${contest.id}/standings?${qs.encode({watching: atcoder})}`,
						text: result ? [
							Object.entries(standingMap.get(user).TaskResults).filter(([, task]) => task.Status === 1).map(([id, task]) => `[ *${tasks.get(id).Assignment}*${task.Penalty ? ` (${task.Penalty})` : ''} ]`).join(' '),
							stats.map(({title, value}) => `*${title}* ${value}`).join(', '),
						].join('\n') : '',
						footer: result ? `${score}点 (最終提出: ${lastSubmission})` : '',
					};
				}))),
				{
					text: '――――――――――――\n※このランキングに掲出して欲しい人は「@atcoder [atcoderユーザー名]」と書き込んでね',
					color: '#FB8C00',
				},
			],
		});

		for (const {user, result} of userResults) {
			const rank = result.Place.toString();
			const frequency = prime.getFrequency(result.Place);
			const isPrime = frequency.length === 1 && frequency[0].times === 1 && result.Place >= 2;
			if (rank.length >= 3 && new Set(rank.split('')).size === 1) {
				await unlock(user, 'atcoder-repdigit');
			}
			if (isPrime) {
				await unlock(user, 'atcoder-prime');
			}
			if (result && result.IsRated) {
				const standing = standingMap.get(user);
				if (result.NewRating - result.OldRating > 0) {
					await unlock(user, 'atcoder-rating-plus');
				}
				if (result.NewRating - result.OldRating >= 50) {
					await unlock(user, 'atcoder-rating-plus-50');
				}
				if (result.NewRating - result.OldRating < 0) {
					await unlock(user, 'atcoder-rating-minus');
				}
				if (result.NewRating - result.OldRating <= -50) {
					await unlock(user, 'atcoder-rating-minus-50');
				}
				if (result.NewRating >= 2400) {
					await unlock(user, 'atcoder-rating-over-2400');
				}
				if (standings.TaskInfo.every((task) => (
					standing.TaskResults[task.TaskScreenName] &&
					standing.TaskResults[task.TaskScreenName].Score > 0
				))) {
					await unlock(user, 'atcoder-all-solve');
				}
				if (Object.values(standing.TaskResults).every((result) => result.Score === 0)) {
					await unlock(user, 'atcoder-no-solve');
				}
			}
		}
	}

	rtm.on('message', async (message) => {
		if (message.text && message.subtype === undefined && message.text.startsWith('@atcoder ')) {
			const text = message.text.replace(/^@atcoder/, '').trim();

			if (text === 'ユーザー一覧') {
				await slack.chat.postMessage({
					username: 'atcoder',
					icon_emoji: ':atcoder:',
					channel: message.channel,
					text: '',
					attachments: await Promise.all(state.users.map(async (user) => ({
						author_name: await getMemberName(user.slack),
						author_icon: await getMemberIcon(user.slack),
						text: `https://atcoder.jp/users/${user.atcoder}`,
					}))),
				});
			} else if (text.match(/^[\x00-\x7F]+$/)) {
				const atcoderId = text;
				const slackId = message.user;
				if (atcoderId.length > 0) {
					if (state.users.some(({slack}) => slackId === slack)) {
						setState({
							users: state.users.map((user) => user.slack === slackId ? {
								slack: slackId,
								atcoder: atcoderId,
							} : user),
						});
					} else {
						setState({
							users: state.users.concat([{slack: slackId, atcoder: atcoderId}]),
						});
					}
					await slack.reactions.add({
						name: '+1',
						channel: message.channel,
						timestamp: message.ts,
					});
				}
			} else {
				await slack.chat.postMessage({
					username: 'atcoder',
					icon_emoji: ':atcoder:',
					channel: message.channel,
					text: ':wakarazu:',
				});
			}
		}
	});

	setInterval(() => {
		updateContests();
	}, 30 * 60 * 1000);
	updateContests();

	let time = Date.now();
	setInterval(() => {
		const oldTime = time;
		const newTime = Date.now();
		time = newTime;

		for (const contest of state.contests) {
			const prerollTime = contest.date - 15 * 60 * 1000;
			const endTime = contest.date + contest.duration;
			if (oldTime <= prerollTime && prerollTime < newTime) {
				postPreroll(contest.id);
			}
			if (oldTime <= contest.date && contest.date < newTime) {
				postStart(contest.id);
			}
			if (oldTime <= endTime && endTime < newTime) {
				prepostResult(contest.id);
			}
		}
	}, 5 * 1000);

	setInterval(() => {
		const now = Date.now();
		for (const contest of state.contests) {
			const endTime = contest.date + contest.duration;
			if (contest.isPreposted && !contest.isPosted && endTime < now && now < endTime + 60 * 60 * 1000) {
				postResult(contest.id);
			}
		}
	}, 30 * 1000);
};
