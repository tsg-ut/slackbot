import qs from 'querystring';
import {Mutex} from 'async-mutex';
import axios from 'axios';
import {stripIndent} from 'common-tags';
import {sumBy, minBy, sum} from 'lodash';
import moment from 'moment';
import schedule from 'node-schedule';
// @ts-expect-error
import prime from 'primes-and-factors';
import scrapeIt from 'scrape-it';
import {increment, unlock, set, get} from '../achievements/index.js';
import logger from '../lib/logger';
import type {SlackInterface} from '../lib/slack';
import {getMemberIcon, getMemberName} from '../lib/slackUtils';
import State from '../lib/state';
// eslint-disable-next-line no-unused-vars
import type {Results, Standings} from './types';
import {crawlSubmissionsByUser} from './utils';

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

interface StateObj {
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
	const state = await State.init<StateObj>('atcoder', {
		users: [],
		contests: [],
	});

	const updateContests = async () => {
		logger.info('Updating AtCoder contests...');
		const {data: html} = await axios.get<string>('https://atcoder.jp/contests/', {
			headers: {
				'Accept-Language': 'ja-JP',
			},
		});
		const {contests} = scrapeIt.scrapeHTML<{contests: ContestEntry[]}>(html, {
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

			state.contests = contests.filter(({date}: any) => !Number.isNaN(date)).map((contest) => {
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

	const getStandings = async (id: string) => {
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

		return {userStandings, tasks};
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

		const {userStandings, tasks} = await getStandings(id);

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
			if (isContestRated && standing) {
				if (standings.TaskInfo.every((task) => (
					standing.TaskResults[task.TaskScreenName] &&
					standing.TaskResults[task.TaskScreenName].Score > 0
				))) {
					await unlock(user, 'atcoder-all-solve');
				}
			}
		}
		if (isContestRated && standings.TaskInfo.length > 0 && userStandings.filter(({standing}) => standing).length >= 10) {
			const taskName = standings.TaskInfo[0].TaskScreenName;
			const {user} = minBy(
				userStandings.filter(({standing}) => standing),
				({standing}) => {
					const taskResult = standing.TaskResults[taskName];
					if (taskResult && taskResult.Score > 0) {
						return taskResult.Elapsed;
					}
					return Infinity;
				},
			);
			await increment(user, 'atcoder-fastest');
		}
	};

	const postDaily = async () => {
		const now = moment().utcOffset(9).startOf('day').hours(9);
		const oneDayLater = now.clone().add(1, 'day');

		// typical shojin notifications
		logger.info('[atcoder-daily] Fetching result of typical90');
		const {userStandings} = await getStandings('typical90');
		const typicalSolves = new Map<string, number>();

		for (const {user, standing} of userStandings) {
			if (standing === undefined) {
				continue;
			}
			const solves = Object.values(standing.TaskResults).filter((result) => result.Status === 1).length;
			typicalSolves.set(user, solves);
		}

		const dataValues = [];
		let increase = 0;

		for (const user of state.users) {
			logger.info(`[atcoder-daily] Fetching result of ABS (user = ${user.atcoder})`);

			await new Promise((resolve) => setTimeout(resolve, 3000));
			const submissions = await crawlSubmissionsByUser('abs', user.atcoder);
			const acceptedProblems = new Set<string>();

			for (const {result, problemId} of submissions) {
				if (result === 'AC' && problemId !== 'practice_1') {
					acceptedProblems.add(problemId);
				}
			}

			const absSolve = acceptedProblems.size;
			const typicalSolve = typicalSolves.get(user.slack) || 0;

			const previousAbsSolve = (await get(user.slack, 'atcoder-abs-solves')) || 0;
			const previousTypicalSolve = ((await get(user.slack, 'atcoder-typical-solves')) || 0) - previousAbsSolve;

			set(user.slack, 'atcoder-abs-solves', absSolve);
			set(user.slack, 'atcoder-typical-solves', absSolve + typicalSolve);

			increase += Math.max(0, absSolve - previousAbsSolve);
			increase += Math.max(0, typicalSolve - previousTypicalSolve);

			let username = await getMemberName(user.slack);
			if (username.length > 12) {
				username = `${username.slice(0, 10)}...`;
			}

			dataValues.push({
				username,
				values: [
					previousAbsSolve,
					absSolve - previousAbsSolve,
					previousTypicalSolve,
					typicalSolve - previousTypicalSolve,
				],
			});
		}

		dataValues.sort((a, b) => sum(b.values) - sum(a.values));

		if (increase === 0) {
			await slack.chat.postMessage({
				username: 'atcoder',
				icon_emoji: ':atcoder:',
				channel: process.env.CHANNEL_PROCON,
				text: '今日は誰も精進をしなかったよ:relieved:',
			});
		} else {
			const series1 = dataValues.map(({values}) => values[0].toString()).join();
			const series2 = dataValues.map(({values}) => values[1].toString()).join();
			const series3 = dataValues.map(({values}) => values[2].toString()).join();
			const series4 = dataValues.map(({values}) => values[3].toString()).join();
			const labels = dataValues.slice().reverse().map(({username}) => `@${username}`).join('|');

			const chartUrl = `https://image-charts.com/chart?${qs.encode({
				chbr: 3,
				chco: 'fdb45c,ff5500,27c9c2,003fc7',
				chd: `a:${series1}|${series2}|${series3}|${series4}`,
				chma: '0,0,10,10',
				chs: '700x700',
				cht: 'bhs',
				chxl: `1:|${labels}`,
				chxr: '0,0,100',
				chxt: 'x,y',
			})}`;

			await slack.chat.postMessage({
				username: 'atcoder',
				icon_emoji: ':atcoder:',
				channel: process.env.CHANNEL_PROCON,
				text: 'AtCoder典型問題精進状況 (精選10問 + 典型90問)',
				blocks: [
					{
						type: 'image',
						title: {
							type: 'plain_text',
							text: 'AtCoder典型問題精進状況 (精選10問 + 典型90問)',
							emoji: true,
						},
						image_url: chartUrl,
						alt_text: 'AtCoder典型問題精進状況 (精選10問 + 典型90問)',
					},
				],
			});
		}

		// contest notifications
		const contests = state.contests.filter((contest) => now.valueOf() < contest.date && contest.date <= oneDayLater.valueOf());

		logger.info(`[atcoder-daily] Posting daily notifications of ${contests.length} contests...`);

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
			} else if (text.match(/^\w+$/)) {
				const atcoderId = text;
				const slackId = message.user;
				if (atcoderId.length > 0) {
					if (state.users.some(({slack}) => slackId === slack)) {
						state.users = state.users.map((user) => user.slack === slackId ? {
							slack: slackId,
							atcoder: atcoderId,
						} : user);
					} else {
						state.users.push({slack: slackId, atcoder: atcoderId});
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
