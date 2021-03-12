import {constants, promises as fs} from 'fs';
import path from 'path';
import {ChatPostMessageArguments} from '@slack/web-api';
import {Mutex} from 'async-mutex';
import {stripIndent} from 'common-tags';
// @ts-ignore
import schedule from 'node-schedule';
import {unlock} from '../achievements/index.js';
// @ts-ignore
import logger from '../lib/logger.js';
import type {SlackInterface} from '../lib/slack';
import {getMemberName} from '../lib/slackUtils';
import {Contest, User, SolvedInfo} from './lib/BasicTypes';
import {fetchChallsCH, fetchUserProfileCH, findUserByNameCH} from './lib/CHManager';
import {fetchChallsKSN, fetchUserProfileKSN, findUserByNameKSN} from './lib/KSNManager';
import {fetchUserProfileTW, fetchChallsTW, findUserByNameTW} from './lib/TWManager';
import {fetchChallsXYZ, fetchUserProfileXYZ, findUserByNameXYZ} from './lib/XYZManager';

const mutex = new Mutex();

const MINUTE = 60 * 1000;
const HOUR = MINUTE * 60;
const DAY = HOUR * 24;
const CALLME = '@pwnyaa';

const DateGran = {
	MSECOND: 'ms',
	SECOND: 's',
	MINUTE: 'm',
	HOUR: 'h',
	DAY: 'd',
} as const;
// eslint-disable-next-line no-redeclare
type DateGran = typeof DateGran[keyof typeof DateGran];

export const TW_ID = 0;
export const XYZ_ID = 1;
export const CH_ID = 2;
export const KSN_ID = 3;

const UPDATE_INTERVAL = 12;

// Record of registered Users and Contests
export interface State {
	users: User[],
	contests: Contest[],
}

// print as JST
const getPrintableDate = (date: Date) => {
	let strdate = '';
	const jstdate = new Date(date);
	jstdate.setUTCHours(jstdate.getUTCHours() + 9);
	strdate += `${jstdate.getUTCFullYear()}/${jstdate.getUTCMonth() + 1}/${jstdate.getUTCDate()} `;
	strdate += `${jstdate.getUTCHours()}:${jstdate.getUTCMinutes()}`;
	return strdate;
};

const getContestSummary = async (contest: Contest) => {
	let text = '';
	text += `*${contest.title}* (${contest.url})\n`;
	text += `  問題数: ${contest.numChalls}\n`;
	if (contest.joiningUsers.length === 0) {
		text += '  参加者: なし\n';
	} else {
		text += `  参加者: ${contest.joiningUsers.length}匹\n    `;
		for (const user of contest.joiningUsers) {
			text += `${await getMemberName(user.slackId)}   `;
		}
		text += '\n';
	}
	return text;
};

const filterChallSolvedRecent = (challs: SolvedInfo[], solvedIn: number, granular: DateGran) => {
	let limitdate: number = 0;
	if (granular === DateGran.MSECOND) {
		limitdate = Date.now() - solvedIn;
	} else if (granular === DateGran.MINUTE) {
		limitdate = Date.now() - solvedIn * MINUTE;
	} else if (granular === DateGran.SECOND) {
		limitdate = Date.now() - solvedIn * 1000;
	} else if (granular === DateGran.HOUR) {
		limitdate = Date.now() - solvedIn * HOUR;
	} else if (granular === DateGran.DAY) {
		limitdate = Date.now() - solvedIn * DAY;
	}
	const filteredChalls = challs.filter((chall) => chall.solvedAt.getTime() >= limitdate);
	return filteredChalls;
};

const getChallsSummary = (challs: SolvedInfo[], spaces = 0) => {
	let text = '';
	console.log(challs);
	for (const chall of challs) {
		text += ' '.repeat(spaces);
		text += `*${chall.name}* (${chall.score}) ${getPrintableDate(chall.solvedAt)}\n`;
	}
	return text;
};

// assumes update is done in every Sunday 9:00AM
const getLastUpdateDate = () => {
	const now = new Date();
	const last = new Date();
	last.setHours(9, 0, 0);
	if (now.getDay() !== 0) {
		last.setDate(now.getDate() - now.getDay());
		return last;
	}
	if (now.getHours() <= 8) {
		last.setDate(now.getDate() - 7);
		return last;
	}
	return last;
};

export default async ({rtmClient: rtm, webClient: slack}: SlackInterface) => {
	let pendingUsers: { slackid: string, contestid: number, contestUserId: string, threadId: string }[] = [];

	// Restore state
	const statePath = path.resolve(__dirname, 'state.json');
	const exists = await fs.access(statePath, constants.F_OK)
		.then(() => true).catch(() => false);
	const state: State = {
		users: [],
		contests: [],
		...(exists ? JSON.parse((await fs.readFile(statePath)).toString()) : {}),
	};
	await fs.writeFile(statePath, JSON.stringify(state));
	const setState = (object: { [key: string]: any }) => {
		Object.assign(state, object);
		return fs.writeFile(statePath, JSON.stringify(state));
	};

	// Check achievement 'pwnyaa-praise-your-birthday'
	for (const user of state.users) {
		await unlock(user.slackId, 'pwnyaa-praise-your-birthday');
	}

	const getRanking = (solvesAllCtfs: {idCtf: number, solves: {slackid: string, solves: SolvedInfo[]}[]}[]) => {
		const ranks: { slackid: string, solves: number }[] = [];
		// parse profiles
		for (const contest of solvesAllCtfs) {
			for (const solvePerUser of contest.solves) {
				if (solvePerUser.solves.length > 0) {
					if (ranks.some((rank) => rank.slackid === solvePerUser.slackid)) {
						const rankIndex = ranks.indexOf(ranks.find((rank) => rank.slackid === solvePerUser.slackid));
						ranks[rankIndex].solves += solvePerUser.solves.length;
					} else {
						ranks.push({slackid: solvePerUser.slackid, solves: solvePerUser.solves.length});
					}
				}
			}
		}

		// add self-solved declarations
		for (const user of state.users) {
			if (user.selfSolvesWeekly && user.selfSolvesWeekly > 0) {
				if (ranks.some((rank) => rank.slackid === user.slackId)) {
					const rankIndex = ranks.indexOf(ranks.find((rank) => rank.slackid === user.slackId));
					ranks[rankIndex].solves += user.selfSolvesWeekly;
				} else {
					ranks.push({slackid: user.slackId, solves: user.selfSolvesWeekly});
				}
			}
		}

		ranks.sort((l, r) => r.solves - l.solves);
		return ranks;
	};

	// get solve-status from last Saturday 10:00 to today
	const getStatSummary = async () => {
		let text = '*==今週のsolve状況だよ!==*\n\n';
		// fetch each solve status
		const recentSolvesAllCtfs = await fetchRecentSolvesAll(Date.now() - getLastUpdateDate().getTime(), DateGran.MSECOND);
		// count for each CTFs
		for (const recentSolvesPerContest of recentSolvesAllCtfs) {
			let someoneSolved = false;
			const {idCtf, solves} = recentSolvesPerContest;
			const nameCtf = state.contests.find((contest) => contest.id === idCtf).title;
			text += `*${nameCtf}* \n`;
			for (const solvePerUser of solves) {
				if (solvePerUser.solves.length !== 0) {
					const username = await getMemberName(solvePerUser.slackid);
					for (const solve of solvePerUser.solves) {
						text += ` ${username}: ${solve.name}\n`;
					}
					someoneSolved = true;
				}
			}
			if (someoneSolved) {
				text += '\n';
			} else {
				text += ' 誰も解いてないぽよ... :cry:\n\n';
			}
		}
		// also, count for selfe-solves
		text += '*Self-Solves* \n';
		let someoneSolved = false;
		for (const user of state.users) {
			if (user.selfSolvesWeekly) {
				// eslint-disable-next-line no-unused-vars
				for (const _ of [...Array(user.selfSolvesWeekly).keys()]) {
					const username = await getMemberName(user.slackId);
					someoneSolved = true;
					text += ` ${username}: _self-solve_ \n`;
				}
			}
		}
		if (someoneSolved) {
			text += '\n';
		} else {
			text += ' 誰も解いてないぽよ... :cry:\n\n';
		}

		// fetch ranking
		const ranks = getRanking(recentSolvesAllCtfs);
		text += '\n*==暫定ランキングだよ!==*\n';
		if (ranks.length > 0) {
			for (const [ix, user] of ranks.entries()) {
				text += ` *${ix + 1}* 位: *${await getMemberName(user.slackid)}* \t\t*${user.solves}* solves \n`;
			}
		} else {
			text += ' 誰も解いてないからみんな1位だよ！！平和だね！';
		}

		// fetch streaks
		text += '\n*==LongestStreaksの状況だよ!==*\n';
		for (const user of state.users) {
			if (user.longestStreak && user.longestStreak >= 1) {
				text += ` ${await getMemberName(user.slackId)}: *${user.longestStreak} streak!* `;
				if (user.longestStreak === user.currentStreak) {
					text += '(更新中!)\n';
				} else {
					text += `(${user.currentStreak})\n`;
				}
			}
		}

		return text;
	};

	// post usage text. *args* starts right before @pwnyaa
	const resolveUsageMessage = async (args: string[], slackMessage: any) => {
		if (args.length !== 2) {		// format is invalid
			await postMessageThreadDefault(slackMessage, {
				text: stripIndent`
					usage/helpコマンドのフォーマットが違うよ... :cry:
					*format* : _<command name> help_
				`,
			});
		} else {
			if (args[1] === 'check') {
				await postMessageThreadDefault(slackMessage, {
					text: stripIndent`
						*check* コマンド: 現在のsolve状況を確認する

						_check_ <CTF name>: 自分のsolve状況を確認する
						_check_ <CTF name> <slack name> : 他人のsolve状況を確認する(非メンション)
					`,
				});
			} else if (args[1] === 'join') {
				await postMessageThreadDefault(slackMessage, {
					text: stripIndent`
						*join* コマンド: 常設CTFへの参加を宣言する

						_join_ <CTF name> <user ID>: そのCTFにおけるuser IDを直接指定して参加登録する
						_join_ <CTF name> name=<username>: そのCTFにおけるuser nameを指定して参加登録する
						*WARNING* : 名前による検索はクロールコストを伴うため頻繁には行わないでください。
					`,
				});
			} else if (args[1] === 'list') {
				await postMessageThreadDefault(slackMessage, {
					text: stripIndent`
						*list* コマンド: 現在登録されている常設CTFを確認する

						_list_ : CTFのリストを確認する
					`,
				});
			} else if (args[1] === 'pwn') {
				await postMessageThreadDefault(slackMessage, {
					text: stripIndent`
						*pwn* コマンド: 常設CTF以外の問題を解いたことを宣言する

						_pwn_ <chall name>: 解いたことを宣言
						*補足* : 自己宣言した問題は毎週のランキングにおけるsolve数に加算されます
					`,
				});
			} else if (args[1] === 'stat') {
				await postMessageThreadDefault(slackMessage, {
					text: stripIndent`
						*stat* コマンド: 諸々のsolve状況等を確認する

						_stat_ : 今週のsolve状況と暫定ランキングを確認
					`,
				});
			} else {
				await postMessageThreadDefault(slackMessage, {
					text: stripIndent`
						*${args[1]}* は登録されてないコマンドだよ... :cry:
						_help_ コマンドで一覧を確認してね!
					`,
				});
			}
		}
	};

	const getSlackidByName = async (name: string) => {
		const candidates = state.users;
		for (const user of candidates) {
			if (await getMemberName(user.slackId) === name) {
				return user.slackId;
			}
		}
		return null;
	};


	const resolvePendingUser = (thread_ts: string) => {
		const requestingUser = pendingUsers.filter((user) => user.threadId === thread_ts)[0];
		const requestingUserIndex = pendingUsers.indexOf(requestingUser);
		if (requestingUserIndex > -1) {
			pendingUsers.splice(requestingUserIndex, 1);
			return requestingUser;
		}
		return null;
	};

	const setPendingUser = (slackid: string, contestid: number, contestUserId: string, threadId: string) => {
		pendingUsers = pendingUsers.map((user) => user.slackid === slackid && user.contestid === contestid
			? {slackid, contestid, contestUserId, threadId} : user);
		if (!pendingUsers.some((user) => user.slackid === slackid && user.contestid === contestid)) {
			pendingUsers.push({slackid, contestid, contestUserId, threadId});
		}
	};

	// eslint-disable-next-line require-await
	const findUserByName = async (name: string, contestid: number) => {
		if (contestid === TW_ID) {
			return findUserByNameTW(name);
		} else if (contestid === XYZ_ID) {
			return findUserByNameXYZ(name);
		} else if (contestid === CH_ID) {
			return findUserByNameCH(name);
		} else if (contestid === KSN_ID) {
			return findUserByNameKSN(name);
		}
		return null;
	};

	// eslint-disable-next-line require-await
	const fetchUserProfile = async (userid: string, contestid: number) => {
		if (contestid === TW_ID) {
			return fetchUserProfileTW(userid);
		} else if (contestid === XYZ_ID) {
			return fetchUserProfileXYZ(userid);
		} else if (contestid === CH_ID) {
			return fetchUserProfileCH(userid);
		} else if (contestid === KSN_ID) {
			return fetchUserProfileKSN(userid);
		}
		return null;
	};

	// get User of slackid from contest name
	const getUser = (slackid: string, contestname: string): User => {
		let found: User = null;
		for (const contest of state.contests) {
			if (contest.alias.some((alias) => alias === contestname)) {
				for (const user of contest.joiningUsers) {
					if (user.slackId === slackid) {
						found = user;
					}
				}
			}
		}
		return found;
	};

	const addUser2Ctf = (slackId: string, ctfId: number, ctfUserId: string) => {
		let found = false;
		state.contests.forEach((contest, ci) => {
			if (contest.id === ctfId) {
				contest.joiningUsers.forEach((user, ui) => {
					if (user.slackId === slackId) {
						state.contests[ci].joiningUsers[ui].idCtf = ctfUserId;
						found = true;
					}
				});
				if (!found) {
					state.contests[ci].joiningUsers.push({slackId, idCtf: ctfUserId});
				}
			}
		});
		unlock(slackId, 'pwnyaa-praise-your-birthday');
		setState(state);
	};

	const resolveSelfSolve = async (challName: string, slackMessage: any) => {
		const user = state.users.filter((user) => user.slackId === slackMessage.user);
		if (!user) {		// user is not joining any CTFs
			await postMessageDefault(slackMessage, {
				text: stripIndent`
					*${await getMemberName(slackMessage.user)}* はどのCTFにも参加してないよ :cry:
					まずは常設CTFのどれかに登録だけしてね!
				`,
			});
			return;
		}
		state.users.forEach((curUser, ci) => {
			if (curUser.slackId === slackMessage.user) {
				if (curUser.selfSolvesWeekly) {
					state.users[ci].selfSolvesWeekly += 1;
				} else {
					state.users[ci].selfSolvesWeekly = 1;
				}
			}
		});
		await setState(state);
		await postMessageDefault(slackMessage, {
			text: stripIndent`
				<@${await slackMessage.user}> が *${challName}* (self)を解いたよ :pwn:
			`,
		});
	};

	const resolveStreaks = async (solvesAllCtfs: { idCtf: number, solves: { slackid: string, solves: SolvedInfo[] }[] }[]) => {
		state.users.forEach((user, ci) => {
			let solvedThisWeek = false;
			// count for each CTFs
			for (const contest of solvesAllCtfs) {
				if (contest.solves.some((solve) => solve.slackid === user.slackId && solve.solves.length > 0)) {
					solvedThisWeek = true;
					break;
				}
			}
			// also, count for self-solves
			if (user.selfSolvesWeekly > 0) {
				solvedThisWeek = true;
			}

			if (solvedThisWeek) {
				if (state.users[ci].currentStreak) {
					state.users[ci].currentStreak += 1;
					state.users[ci].longestStreak = Math.max(state.users[ci].longestStreak, state.users[ci].currentStreak);
				} else {
					state.users[ci].currentStreak = 1;
					state.users[ci].longestStreak = 1;
				}
			} else {
				state.users[ci].currentStreak = 0;
			}
		});
		await setState(state);
	};

	// fetch data from TW and update state
	const updateChallsTW = async () => {
		const fetchedChalls = await fetchChallsTW();

		const oldtw = state.contests.find((({title}) => title === 'pwnable.tw'));
		const updatedtw: Contest = {
			url: 'https://pwnable.tw',
			id: TW_ID,
			title: 'pwnable.tw',
			alias: oldtw ? oldtw.alias : ['tw'],
			joiningUsers: oldtw ? oldtw.joiningUsers : [],
			numChalls: fetchedChalls.length,
		};
		if (oldtw) {
			state.contests = state.contests.map((cont) => cont.id === updatedtw.id ? updatedtw : cont);
		} else {
			state.contests.push(updatedtw);
		}
		setState(state);
	};

	// fetch data from CH and update state
	const updateChallsCH = async () => {
		const fetchedChalls = await fetchChallsCH();

		const oldch = state.contests.find((({title}) => title === 'cryptohack'));
		const updatedch: Contest = {
			url: 'https://cryptohack.org',
			id: CH_ID,
			title: 'cryptohack',
			alias: oldch ? oldch.alias : ['cryptohack', 'ch'],
			joiningUsers: oldch ? oldch.joiningUsers : [],
			numChalls: fetchedChalls.length,
		};
		if (oldch) {
			state.contests = state.contests.map((cont) => cont.id === updatedch.id ? updatedch : cont);
		} else {
			state.contests.push(updatedch);
		}
		setState(state);
	};

	// fetch data from XYZ and update state
	const updateChallsXYZ = async () => {
		const fetchedChalls = await fetchChallsXYZ();

		// register challenges
		const oldxyz = state.contests.find((({title}) => title === 'pwnable.xyz'));
		const updatedxyz: Contest = {
			url: 'https://pwnable.xyz',
			id: XYZ_ID,
			title: 'pwnable.xyz',
			alias: oldxyz ? oldxyz.alias : ['xyz'],
			joiningUsers: oldxyz ? oldxyz.joiningUsers : [],
			numChalls: fetchedChalls.length,
		};
		if (oldxyz) {
			state.contests = state.contests.map((cont) => cont.id === updatedxyz.id ? updatedxyz : cont);
		} else {
			state.contests.push(updatedxyz);
		}
		setState(state);
	};

	// fetch data from KSN and update state
	const updateChallsKSN = async () => {
		const fetchedChalls = await fetchChallsKSN();

		// register challenges
		const oldksn = state.contests.find((({title}) => title === 'ksnctf'));
		const updatedksn: Contest = {
			url: 'https://ksnctf.sweetduet.info',
			id: KSN_ID,
			title: 'ksnctf',
			alias: oldksn ? oldksn.alias : ['ksn', 'ksnctf'],
			joiningUsers: oldksn ? oldksn.joiningUsers : [],
			numChalls: fetchedChalls.length,
		};
		if (oldksn) {
			state.contests = state.contests.map((cont) => cont.id === updatedksn.id ? updatedksn : cont);
		} else {
			state.contests.push(updatedksn);
		}
		setState(state);
	};

	rtm.on('message', async (message) => {
		// resolve pending join request
		if (message.text && message.text.startsWith(':pwn:')) {
			for (const user of pendingUsers) {
				if (user.slackid === message.user && user.threadId === message.thread_ts) {
					const requestingUser = resolvePendingUser(message.thread_ts);
					const selectedContestId = requestingUser.contestid;
					const selectedUserId = requestingUser.contestUserId;
					const userProfile = await fetchUserProfile(selectedUserId, selectedContestId);
					if (!state.users.some((user) => message.user === user.slackId)) {
						setState({
							users: state.users.concat([{slackId: message.user, idCtf: ''}]),
						});
					}
					if (userProfile) {
						addUser2Ctf(message.user, selectedContestId, selectedUserId);
						await postMessageDefault(message, {
							text: stripIndent`
								登録したよ! :azaika:
								ユーザ名  : ${userProfile.username}
								スコア   : ${userProfile.score}
								ランキング: ${userProfile.rank}
								${userProfile.comment}
						`,
						});
					}
				}
			}
			return;
		}

		// handle commands
		if (message.text && message.subtype === undefined &&
      message.text.startsWith(CALLME) && (message.channel === process.env.CHANNEL_SANDBOX || process.env.CHANNEL_PWNABLE_TW || message.channel.startsWith('D'))) { // message is toward me
			const args = message.text.split(' ').slice(1);

			// show list of registered contests summary
			if (args[0] === 'list') {
				await postMessageDefault(message, {
					text: await (await Promise.all(state.contests.map(
						(contest) => getContestSummary(contest),
					))).join(''),
				});

				/** ** END of list ****/

				// join the contest
			} else if (args[0] === 'join') {
				const selectedContestName = args[1];
				const selectedContest =
					// eslint-disable-next-line max-len
					state.contests.find((contest) => contest.alias.some((alias) => alias === selectedContestName) || contest.title === selectedContestName);


				if (selectedContest) {	// contest is found
					if (args[2]) {				// syntax is valid
						await addReactionDefault(message, 'ok');

						if ((args[2] as string).startsWith('name=')) {	// check by name
							const specifiedUsername = (args[2] as string).substring('name='.length);
							const foundUser = await findUserByName(specifiedUsername, selectedContest.id);
							if (foundUser) {															// user is found on the contest
								setPendingUser(message.user, selectedContest.id, foundUser.userid, message.ts);
								await postMessageThreadDefault(message, {
									text: stripIndent`
									このユーザであってるかな...? OKならこのスレッドで:pwn:とコメントしてね!
									  *ユーザ名* : ${foundUser.name}
									  *ID* : ${foundUser.userid}
									`,
								});
							} else {																		// user is not found on the contest
								await postMessageDefault(message, {
									text: `ユーザ *${specifiedUsername}* は *${selectedContestName}* に見つからなかったよ:cry: (1問も解いていない場合には参加できない場合があるよ)`,
								});
							}
						} else {																			// check by ID
							const selectedUserId = args[2];
							const userProfile = await fetchUserProfile(selectedUserId, selectedContest.id);
							if (userProfile) {												// user is found on the contest
								if (!state.users.some((user) => message.user === user.slackId)) {
									setState({
										users: state.users.concat([{slackId: message.user, idCtf: ''}]),
									});
								}
								addUser2Ctf(message.user, selectedContest.id, selectedUserId);
								await postMessageDefault(message, {
									text: stripIndent`
										登録したよ! :azaika:
										ユーザ名  : ${userProfile.username}
										スコア   : ${userProfile.score}
										ランキング: ${userProfile.rank}
										${userProfile.comment}
										`,
								});
							} else {																// user is not found on the contest
								await postMessageDefault(message, {
									text: `ユーザID *${selectedUserId}* は *${selectedContestName}* に見つからなかったよ:cry:`,
								});
							}
						}
					} else {							// syntax is invalid
						await postMessageDefault(message, {
							text: stripIndent`
								*join* コマンド: ある常設CTFに登録する
									_join_  _<CTF name/alias>_  _<UserID | name=USERNAME>_
							`,
						});
					}
				} else {					// contest not found
					await postMessageDefault(message, {
						text: stripIndent`
							コンテスト *${selectedContestName}* は見つからなかったよ...
							現在登録されてるコンテスト一覧を見てね!
						`,
					});
					await postMessageDefault(message, {
						text: await (await Promise.all(state.contests.map(
							(contest) => getContestSummary(contest),
						))).join(''),
					});
				}

				/** ** END of join ****/

				// check user status of the specified CTF.
			} else if (args[0] === 'check') {
				const selectedContestName = args[1];
				if (selectedContestName) {			// contest is found
					let specifiedUserSlackid: string = null;
					if (args.length === 3) {
						specifiedUserSlackid = await getSlackidByName(args[2]);
					} else {
						specifiedUserSlackid = message.user;
					}
					const user = getUser(specifiedUserSlackid, selectedContestName);
					if (user) {										// user is found local
						// eslint-disable-next-line max-len
						const selectedContest = state.contests.find((contest) => contest.alias.some((alias) => alias === selectedContestName) || contest.title === selectedContestName);
						if (selectedContest) {			// contest is found
							const fetchedProfile = await fetchUserProfile(user.idCtf, selectedContest.id);

							await postMessageThreadDefault(message, {
								text: `${`ユーザ名  : *${fetchedProfile.username}* \n` +
									`スコア   : *${fetchedProfile.score}* \n` +
									`ランキング: *${fetchedProfile.rank}* \n` +
									`${fetchedProfile.comment} \n` +
									'解いた問題: \n'}${getChallsSummary(fetchedProfile.solvedChalls, 2)}`,
							});
						} else {										// contest is not found
							await postMessageDefault(message, {
								text: stripIndent`
									コンテスト *${selectedContestName}* は見つからなかったよ...
									現在登録されてるコンテスト一覧を見てね!
								`,
							});
						}
					} else {
						await postMessageDefault(message, {
							text: stripIndent`
							まだ *${selectedContestName}* に参加してないよ。 *join* コマンドで参加登録してね!
							`,
						});
					}
				} else {
					await postMessageDefault(message, {
						text: stripIndent`
						*check* コマンド: あるCTFにおける自分のステータス確認
						_check_  _<CTF name/alias>_
						`,
					});
				}

				/** ** END of check ****/
			} else if (args[0] === 'pwn') {		// self solve declaration
				if (args.length <= 1) {						// command format is invalid
					await postMessageDefault(message, {
						text: stripIndent`
							*:pwn:* コマンド: 登録されている以外のCTFの問題を解いたことの自己宣言
							*format* : _:pwn:_ _<chall name>_
						`,
					});
				} else {													// command format is valid
					// concatnate solved-chall name
					let challName = '';
					for (const partName of args.slice(1)) {
						challName += ` ${partName}`;
					}
					challName = challName.slice(1);
					await resolveSelfSolve(challName, message);
				}

				/** ** END of pwn ****/
			} else if (args[0] === 'help' || args[0] === 'usage') {
				if (args.length >= 2) {
					await resolveUsageMessage(args, message);
				} else {
					await postMessageThreadDefault(message, {
						text: stripIndent`
							*list* : 開催中のCTF一覧
							*join* : CTFに参加登録
							*check* : ステータス確認
							*pwn* : 問題を解いたことの自己宣言
							*stat* : 今週の諸々の状況を確認
							詳しいフォーマットを知りたいときは、 _@pwnyaa help <command name>_ で聞いてね!
							`,
					});
				}

				/** ** END of help/usage ****/
			} else if (args[0] === 'stat') {
				// it takes some time to fetch all information
				await addReactionDefault(message, 'ok');
				await postMessageThreadDefault(message, {
					text: await getStatSummary(),
				});

				// unknown command
			} else {
				await postMessageDefault(message, {text: ':wakarazu:'});
			}
		}
	});

	const postMessageDefault = async (receivedMessage: any, config = {}) => {
		const postingConfig: ChatPostMessageArguments = {
			username: 'pwnyaa',
			icon_emoji: ':pwn:',
			channel: receivedMessage.channel,
			text: '',
			...config,
		};
		await slack.chat.postMessage(postingConfig);
	};

	const addReactionDefault = async (receivedMessage: any, emoji: string) => {
		await slack.reactions.add({
			name: emoji,
			channel: receivedMessage.channel,
			timestamp: receivedMessage.ts,
		});
	};

	const postMessageThreadDefault = async (receivedMessage: any, config = {}) => {
		const postingConfig: ChatPostMessageArguments = {
			username: 'pwnyaa',
			icon_emoji: ':pwn:',
			channel: receivedMessage.channel,
			thread_ts: receivedMessage.ts,
			text: '',
			...config,
		};
		await slack.chat.postMessage(postingConfig);
	};

	const checkAchievementsTW = async () => {
		logger.info('[+] pwnyaa: checking achievements for TW...');
		const contestTW = state.contests.find((contest) => contest.id === TW_ID);
		for (const user of contestTW.joiningUsers) {
			const profile = await fetchUserProfileTW(user.idCtf);
			if (profile.solvedChalls.length >= contestTW.numChalls) {
				logger.info('[+] pwnyaa: unlocking: pwnyaa-tw-complete');
				await unlock(user.slackId, 'pwnyaa-tw-complete');
			}
			if (profile.solvedChalls.length >= contestTW.numChalls / 2) {
				logger.info('[+] pwnyaa: unlocking: pwnyaa-tw-half');
				await unlock(user.slackId, 'pwnyaa-tw-half');
			}
		}
	};
	const checkAchievementsXYZ = async () => {
		logger.info('[+] pwnyaa: checking achievements for XYZ...');
		const contestXYZ = state.contests.find((contest) => contest.id === XYZ_ID);
		for (const user of contestXYZ.joiningUsers) {
			const profile = await fetchUserProfileXYZ(user.idCtf);
			if (profile.solvedChalls.length >= contestXYZ.numChalls) {
				logger.info('[+] pwnyaa: unlocking: pwnyaa-xyz-complete');
				await unlock(user.slackId, 'pwnyaa-xyz-complete');
			}
			if (profile.solvedChalls.length >= contestXYZ.numChalls / 2) {
				logger.info('[+] pwnyaa: unlocking: pwnyaa-xyz-half');
				await unlock(user.slackId, 'pwnyaa-xyz-half');
			}
		}
	};
	const checkAchievementsCH = async () => {
		logger.info('[+] pwnyaa: checking achievements for CH...');
		const contestCH = state.contests.find((contest) => contest.id === CH_ID);
		for (const user of contestCH.joiningUsers) {
			const profile = await fetchUserProfileCH(user.idCtf);
			if (profile.solvedChalls.length >= contestCH.numChalls) {
				logger.info('[+] pwnyaa: unlocking: pwnyaa-ch-complete');
				await unlock(user.slackId, 'pwnyaa-ch-complete');
			}
			if (profile.solvedChalls.length >= contestCH.numChalls / 2) {
				logger.info('[+] pwnyaa: unlocking: pwnyaa-ch-half');
				await unlock(user.slackId, 'pwnyaa-ch-half');
			}
		}
	};
	const checkAchievementsKSN = async () => {
		logger.info('[+] pwnyaa: checking achievements for KSN...');
		const contestKSN = state.contests.find((contest) => contest.id === KSN_ID);
		for (const user of contestKSN.joiningUsers) {
			const profile = await fetchUserProfileKSN(user.idCtf);
			if (profile.solvedChalls.length >= contestKSN.numChalls) {
				logger.info('[+] pwnyaa: unlocking: pwnyaa-ksn-complete');
				await unlock(user.slackId, 'pwnyaa-ksn-complete');
			}
			if (profile.solvedChalls.length >= contestKSN.numChalls / 2) {
				logger.info('[+] pwnyaa: unlocking: pwnyaa-ksn-half');
				await unlock(user.slackId, 'pwnyaa-ksn-half');
			}
		}
	};

	// fetch challs of all CTFs solved recently
	const fetchRecentSolvesAll = async (solvedIn: number, granular: DateGran) => {
		const recentSolvesAllCtfs: {
			idCtf: number,
			solves: { slackid: string, solves: SolvedInfo[] }[],
		}[] = [];
		for (const contest of state.contests) {
			const allRecentSolves: { slackid: string, solves: SolvedInfo[] }[] = [];
			for (const user of contest.joiningUsers) {
				const profile = await fetchUserProfile(user.idCtf, contest.id);
				if (profile !== null) {
					const recentSolves = filterChallSolvedRecent(profile.solvedChalls, solvedIn, granular);
					allRecentSolves.push({slackid: user.slackId, solves: recentSolves});
				}
			}
			recentSolvesAllCtfs.push({idCtf: contest.id, solves: allRecentSolves});
		}
		return recentSolvesAllCtfs;
	};

	const postProgress = async () => {
		logger.info('[+] pwnyaa: progress posting...');

		let text = '';
		let someoneSolved = false;
		const recentSolvesAllCtfs = await fetchRecentSolvesAll(UPDATE_INTERVAL, DateGran.HOUR);
		for (const solvesPerContest of recentSolvesAllCtfs) {
			for (const solvesPerUser of solvesPerContest.solves) {
				for (const solve of solvesPerUser.solves) {
					text += `<@${solvesPerUser.slackid}> が *${solve.name}* (${solve.score})を解いたよ :pwn: \n`;
					someoneSolved = true;
				}
			}
		}
		if (someoneSolved) {
			logger.info('[+] someone solved challs...');
			slack.chat.postMessage({
				username: 'pwnyaa',
				icon_emoji: ':pwn:',
				channel: process.env.CHANNEL_PWNABLE_TW,
				text,
			});
		}
	};

	const postWeekly = async () => {
		logger.info('[+] pwnyaa: posting weekly...');

		// get ranking
		const recentSolvesAllCtfs = await fetchRecentSolvesAll(7, DateGran.DAY);
		const ranks = getRanking(recentSolvesAllCtfs);

		// resolve streaks
		await resolveStreaks(recentSolvesAllCtfs);

		// gen text
		ranks.sort((l, r) => r.solves - l.solves);
		let text = '';
		if (ranks.length > 0) {
			text += '今週のpwnランキングを発表するよ〜\n';
			for (const [ix, user] of ranks.entries()) {
				text += `*${ix + 1}* 位: *${await getMemberName(user.slackid)}* \t\t*${user.solves}* solves \n`;
			}
			text += '\nおめでとう〜〜〜〜〜〜〜〜 :genius:\n';
		} else {
			text += '今週は誰も問題を解かなかったよ... :cry:\n';
		}

		text += '\n';
		for (const user of state.users) {
			if (user.longestStreak && user.longestStreak === user.currentStreak) {
				text += `:azaika-is-blue-coder: *${await getMemberName(user.slackId)}* がLongestStreakを更新したよ! *(${user.longestStreak} streak!)* \n`;
			}
		}

		slack.chat.postMessage({
			username: 'pwnyaa',
			icon_emoji: ':pwn:',
			channel: process.env.CHANNEL_PWNABLE_TW,
			text,
		});

		// clear self-solves count
		state.users = state.users.map((user) => {
			user.selfSolvesWeekly = 0;
			return user;
		});
		setState(state);
	};

	const updateAll = async () => {
		await updateChallsXYZ();
		await updateChallsTW();
		await updateChallsCH();
		await updateChallsKSN();
		await checkAchievementsXYZ();
		await checkAchievementsTW();
		await checkAchievementsCH();
		await checkAchievementsKSN();
	};

	// update the num of challs and achievements every 12 hours
	setInterval(() => {
		mutex.runExclusive(() => {
			updateAll();
		});
	}, UPDATE_INTERVAL * HOUR);

	schedule.scheduleJob('0 9 * * 0', () => {
		mutex.runExclusive(() => {
			postWeekly();
		});
	});

	schedule.scheduleJob('0 10 * * *', () => {
		mutex.runExclusive(() => {
			postProgress();
		});
	});
	schedule.scheduleJob('0 22 * * *', () => {
		mutex.runExclusive(() => {
			postProgress();
		});
	});

	// init
	updateAll();
};
