import {constants, promises as fs} from 'fs';
import path from 'path';
import qs from 'querystring';
import {Mutex} from 'async-mutex';
import axios from 'axios';
// @ts-ignore
import {stripIndent} from 'common-tags';
import {sumBy} from 'lodash';
import moment from 'moment';
// @ts-ignore
import schedule from 'node-schedule';
// @ts-ignore
import prime from 'primes-and-factors';
import scrapeIt from 'scrape-it';
import {increment, unlock} from '../achievements/index.js';
// @ts-ignore
import logger from '../lib/logger.js';
import type {SlackInterface} from '../lib/slack';
import {getMemberIcon, getMemberName} from '../lib/slackUtils';
// eslint-disable-next-line no-unused-vars
import {Results, Standings} from './types';

const mutex = new Mutex();

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

const getRatingColorName = (rating: number | null) => {
	if (rating === null || rating < 400) {
		return '灰';
	}
	if (rating < 800) {
		return '茶';
	}
	if (rating < 1200) {
		return '緑';
	}
	if (rating < 1600) {
		return '水';
	}
	if (rating < 2000) {
		return '青';
	}
	if (rating < 2400) {
		return '黄';
	}
	if (rating < 2800) {
		return '橙';
	}
	if (rating < 3200) {
		return '赤';
	}
	return '???';
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
};

interface State {
	users: {atcoder: string, slack: string}[],
	contests: {id: string, date: number, title: string, duration: number, isPosted: boolean, isPreposted: boolean, ratedCount: number}[],
}

interface ContestEntry {
	date: number,
	title: string,
	id: string,
	duration: number,
}

export default async ({rtmClient: rtm, webClient: slack}: SlackInterface) => {
	const statePath = path.resolve(__dirname, 'state.json');
	const exists = await fs.access(statePath, constants.F_OK).then(() => true).catch(() => false);
	const state: State = {
		users: [],
		contests: [],
		...(exists ? JSON.parse((await fs.readFile(statePath)).toString()) : {}),
	};

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
		const {contests} = await scrapeIt.scrapeHTML<{contests: ContestEntry[]}>(html, {
			contests: {
				listItem: 'tbody tr',
				data: {
					date: {
						selector: 'td:nth-child(1) time',
						convert: (time) => new Date(time).getTime(),
					},
					title: {
						selector: 'td:nth-child(2)',
						convert: (title) => title.replace('◉', '').trim(),
					},
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
			const newContests: ContestEntry[] = [];
			setState({
				contests: contests.filter(({date}: any) => !Number.isNaN(date)).map((contest) => {
					const oldContest = oldContests.find(({id}) => id === contest.id);
					if (!oldContest) {
						newContests.push(contest);
					}
					return {
						...contest,
						isPosted: oldContest ? oldContest.isPosted : false,
						isPreposted: oldContest ? oldContest.isPreposted : false,
						ratedCount: 0,
					};
				}),
			});
			for (const contest of newContests) {
				await postNewContest(contest.id);
			}
		}
	};

	const postNewContest = (id: string) => {
		const contest = state.contests.find((contest) => contest.id === id);
		logger.info(`Posting notification of new contest ${id}...`);

		slack.chat.postMessage({
			username: 'atcoder',
			icon_emoji: ':atcoder:',
			channel: process.env.CHANNEL_PROCON,
			text: stripIndent`
				新しいコンテスト *${contest.title}* が追加されたよ！
				https://atcoder.jp/contests/${contest.id}
			`,
		});
	};

	const postPreroll = (id: string) => {
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

	const postStart = (id: string) => {
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

		logger.info(`Preposting result of contest ${id}...`);

		const {data: standings}: {data: Standings} = await axios.get(`https://atcoder.jp/contests/${id}/standings/json`, {
			headers: {
				Cookie: `REVEL_SESSION=${process.env.ATCODER_SESSION_ID}`,
			},
		});

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
				...(await Promise.all(userStandings.filter(({standing}) => standing).map(async ({user, atcoder, standing}) => {
					const score = standing.TotalResult.Score / 100;
					const lastSubmission = formatTime(standing.TotalResult.Elapsed / 1000000000);

					return {
						color: getRatingColor(standing.Rating),
						author_name: `${await getMemberName(user)}: ${standing.Rank}位 (暫定)`,
						author_icon: await getMemberIcon(user),
						author_link: `https://atcoder.jp/contests/${contest.id}/standings?${qs.encode({watching: atcoder})}`,
						text: Object.entries(standing.TaskResults).filter(([, task]) => task.Status === 1).map(([id, task]) => `[ *${tasks.get(id).Assignment}*${task.Penalty ? ` (${task.Penalty})` : ''} ]`).join(' '),
						footer: `${score}点 (最終提出: ${lastSubmission})`,
					};
				}))),
				{
					text: '――――――――――――\n※このランキングに掲出して欲しい人は「@atcoder [atcoderユーザー名]」と書き込んでね',
					color: '#FB8C00',
				},
			],
		});

		contest.isPreposted = true;
		setState({contests: state.contests});
	};

	const getRatedCount = async (id: string) => {
		const {data: results}: {data: Results} = await axios.get(`https://atcoder.jp/contests/${id}/results/json`, {
			headers: {
				Cookie: `REVEL_SESSION=${process.env.ATCODER_SESSION_ID}`,
			},
		});
		return sumBy(results, ({IsRated}) => IsRated ? 1 : 0);
	};

	const postResult = async (id: string) => {
		const contest = state.contests.find((contest) => contest.id === id);

		const {data: results}: {data: Results} = await axios.get(`https://atcoder.jp/contests/${id}/results/json`, {
			headers: {
				Cookie: `REVEL_SESSION=${process.env.ATCODER_SESSION_ID}`,
			},
		});
		if (results.length === 0) {
			return;
		}

		logger.info(`Posting result of contest ${id}...`);

		const resultMap = new Map(state.users.map(({atcoder, slack}) => {
			const result = results.find(({UserName, UserScreenName}) => UserName === atcoder || UserScreenName === atcoder);
			return [slack, result];
		}));

		const {data: standings}: {data: Standings} = await axios.get(`https://atcoder.jp/contests/${id}/standings/json`, {
			headers: {
				Cookie: `REVEL_SESSION=${process.env.ATCODER_SESSION_ID}`,
			},
		});
		const userStandings = state.users.map(({atcoder, slack}) => {
			const standing = standings.StandingsData.find(({UserName, UserScreenName}) => UserName === atcoder || UserScreenName === atcoder);
			return {user: slack, atcoder, standing};
		}).sort((a, b) => (a.standing ? a.standing.Rank : 1e9) - (b.standing ? b.standing.Rank : 1e9));

		const tasks = new Map(standings.TaskInfo.map((task) => [task.TaskScreenName, task]));

		const colorUpdates: {user: string, oldRating: number, newRating: number}[] = [];

		await slack.chat.postMessage({
			username: 'atcoder',
			icon_emoji: ':atcoder:',
			channel: process.env.CHANNEL_PROCON,
			text: stripIndent`
				*${contest.title}* の順位が確定したよ～:checkered_flag:
			`,
			attachments: [
				...(await Promise.all(userStandings.filter(({standing}) => standing).map(async ({user, atcoder, standing}) => {
					const score = standing.TotalResult.Score / 100;
					const lastSubmission = formatTime(standing.TotalResult.Elapsed / 1000000000);
					const result = resultMap.get(user);
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

					if (result && getRatingColor(result.OldRating) !== getRatingColor(result.NewRating)) {
						colorUpdates.push({
							user,
							newRating: result.NewRating,
							oldRating: result.OldRating,
						});
					}

					return {
						color: getRatingColor(standing.Rating),
						author_name: `${await getMemberName(user)}: ${standing.Rank}位`,
						author_icon: await getMemberIcon(user),
						author_link: `https://atcoder.jp/contests/${contest.id}/standings?${qs.encode({watching: atcoder})}`,
						text: [
							Object.entries(standing.TaskResults).filter(([, task]) => task.Status === 1).map(([id, task]) => `[ *${tasks.get(id).Assignment}*${task.Penalty ? ` (${task.Penalty})` : ''} ]`).join(' '),
							stats.map(({title, value}) => `*${title}* ${value}`).join(', '),
						].join('\n'),
						footer: `${score}点 (最終提出: ${lastSubmission})`,
					};
				}))),
				{
					text: '――――――――――――\n※このランキングに掲出して欲しい人は「@atcoder [atcoderユーザー名]」と書き込んでね',
					color: '#FB8C00',
				},
			],
		});

		for (const {user, newRating, oldRating} of colorUpdates) {
			const verb = newRating > oldRating ? '昇格しました！🎉🎉🎉🎉🎉🎉🎉' : '降格しました⋯😢😢😢😢😢😢😢';
			await slack.chat.postMessage({
				username: 'atcoder',
				icon_emoji: ':atcoder:',
				channel: process.env.CHANNEL_PROCON,
				text: stripIndent`
					<@${user}>が${getRatingColorName(newRating)}コーダーに${verb}
				`,
			});
		}

		const isContestRated = standings.StandingsData.some((standing) => standing.IsRated);

		contest.isPosted = true;
		setState({contests: state.contests});

		for (const {user, standing} of userStandings) {
			const result = resultMap.get(user);
			if (standing) {
				const rank = standing.Rank.toString();
				const frequencies = prime.getFrequency(standing.Rank);
				const isPrime = frequencies.length === 1 && frequencies[0].times === 1 && standing.Rank >= 2;
				if (isContestRated) {
					await increment(user, 'atcoder-participate');
				}
				if (rank.length >= 3 && new Set(rank.split('')).size === 1) {
					await unlock(user, 'atcoder-repdigit');
				}
				if (isPrime) {
					await unlock(user, 'atcoder-prime');
				}
			}
			if (result && result.IsRated) {
				if (result.NewRating - result.OldRating > 0) {
					await unlock(user, 'atcoder-rating-plus');
				}
				if (result.NewRating - result.OldRating >= 50) {
					await unlock(user, 'atcoder-rating-plus-50');
				}
				if (result.NewRating === result.OldRating) {
					await unlock(user, 'atcoder-rating-plus-minus-zero');
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
				if (Object.values(standing.TaskResults).every((result) => result.Score === 0)) {
					await unlock(user, 'atcoder-no-solve');
				}
			}
			if (isContestRated) {
				if (standings.TaskInfo.every((task) => (
					standing.TaskResults[task.TaskScreenName] &&
					standing.TaskResults[task.TaskScreenName].Score > 0
				))) {
					await unlock(user, 'atcoder-all-solve');
				}
			}
		}
	};

	const postDaily = async () => {
		const now = moment().utcOffset(9).startOf('day').hours(9);
		const oneDayLater = now.clone().add(1, 'day');

		const contests = state.contests.filter((contest) => now.valueOf() < contest.date && contest.date <= oneDayLater.valueOf());

		logger.info(`Posting daily notifications of ${contests.length} contests...`);

		for (const contest of contests) {
			const date = moment(contest.date).utcOffset(9);
			const hour = (date.hour() < 9 ? date.hour() + 24 : date.hour()).toString().padStart(2, '0');
			const minute = date.minute().toString().padStart(2, '0');

			await slack.chat.postMessage({
				username: 'atcoder',
				icon_emoji: ':atcoder:',
				channel: process.env.CHANNEL_PROCON,
				text: stripIndent`
					本日${hour}:${minute}から＊${contest.title}＊開催です🙋
					https://atcoder.jp/contests/${contest.id}
				`,
			});
		}
	};

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
		mutex.runExclusive(() => {
			updateContests();
		});
	}, 30 * 60 * 1000);
	updateContests();

	let time = Date.now();
	setInterval(() => {
		const oldTime = time;
		const newTime = Date.now();
		time = newTime;

		mutex.runExclusive(async () => {
			for (const contest of state.contests) {
				const prerollTime = contest.date - 15 * 60 * 1000;
				const endTime = contest.date + contest.duration;
				if (oldTime <= prerollTime && prerollTime < newTime) {
					await postPreroll(contest.id);
				}
				if (oldTime <= contest.date && contest.date < newTime) {
					await postStart(contest.id);
				}
				if (oldTime <= endTime && endTime < newTime) {
					await prepostResult(contest.id);
				}
			}
		});
	}, 5 * 1000);

	setInterval(() => {
		const now = Date.now();
		mutex.runExclusive(async () => {
			for (const contest of state.contests) {
				const endTime = contest.date + contest.duration;
				if (contest.isPreposted && !contest.isPosted && endTime < now && now < endTime + 60 * 60 * 1000) {
					const ratedCount = await getRatedCount(contest.id);
					if (ratedCount > 10 && contest.ratedCount === ratedCount) {
						await postResult(contest.id);
					}
					contest.ratedCount = ratedCount;
				}
			}
		});
	}, 30 * 1000);

	schedule.scheduleJob('0 9 * * *', () => {
		mutex.runExclusive(() => {
			postDaily();
		});
	});
};
