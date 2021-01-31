import {constants, promises as fs} from 'fs';
import path from 'path';
import {ChatPostMessageArguments} from '@slack/web-api';
import {Mutex} from 'async-mutex';
import {stripIndent} from 'common-tags';
import schedule from 'node-schedule';
import {unlock} from '../achievements/index.js';
import type {SlackInterface} from '../lib/slack';
import {getMemberName} from '../lib/slackUtils';
import {Contest, User, SolvedInfo} from './lib/BasicTypes';
import {fetchUserProfileTW, fetchChallsTW, findUserByNameTW} from './lib/TWManager';
import {fetchChallsXYZ, fetchUserProfileXYZ, findUserByNameXYZ} from './lib/XYZManager';

const mutex = new Mutex();

const MINUTE = 60 * 1000;
const HOUR = MINUTE * 60;
const DAY = HOUR * 24;
const CALLME = '@pwnyaa';

export const TW_ID = 0;
export const XYZ_ID = 1;

const UPDATE_INTERVAL = 12;

// Record of registered Users and Contests
export interface State {
	users: User[],
  contests: Contest[],
}

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

const filterChallSolvedRecent = (challs: SolvedInfo[], solvedIn: number, hour = false) => {
	let limitdate: number = 0;
	if (hour) {
		limitdate = Date.now() - solvedIn * HOUR;
	} else {
		limitdate = Date.now() - solvedIn * DAY;
	}
	const filteredChalls = challs.filter((chall) => chall.solvedAt.valueOf() >= limitdate);
	return filteredChalls;
};

const getChallsSummary = (challs: SolvedInfo[], spaces = 0) => {
	let text = '';
	for (const chall of challs) {
		text += ' '.repeat(spaces);
		text += `*${chall.name}* (${chall.score}) ${chall.solvedAt.toLocaleString()}\n`;
	}
	return text;
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
		}
		return null;
	};

	// eslint-disable-next-line require-await
	const fetchUserProfile = async (userid: string, contestid: number) => {
		if (contestid === TW_ID) {
			return fetchUserProfileTW(userid);
		} else if (contestid === XYZ_ID) {
			return fetchUserProfileXYZ(userid);
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
		setState(state);
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
									text: `ユーザ *${specifiedUsername}* は *${selectedContestName}* に見つからなかったよ:cry:`,
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
			} else if (args[0] === 'help' || args[0] === 'usage') {
				await postMessageThreadDefault(message, {
					text: stripIndent`
						*list* : 開催中のCTF一覧
						*join* : CTFに参加登録
						*check* : ステータス確認
						`,
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
		const contestTW = state.contests.find((contest) => contest.id === TW_ID);
		for (const user of contestTW.joiningUsers) {
			const profile = await fetchUserProfileTW(user.idCtf);
			if (profile.solvedChalls.length >= contestTW.numChalls) {
				await unlock(user.slackId, 'pwnyaa-tw-complete');
			}
			if (profile.solvedChalls.length >= contestTW.numChalls / 2) {
				await unlock(user.slackId, 'pwnyaa-tw-half');
			}
		}
	};
	const checkAchievementsXYZ = async () => {
		const contestXYZ = state.contests.find((contest) => contest.id === XYZ_ID);
		for (const user of contestXYZ.joiningUsers) {
			const profile = await fetchUserProfileXYZ(user.idCtf);
			if (profile.solvedChalls.length >= contestXYZ.numChalls) {
				await unlock(user.slackId, 'pwnyaa-xyz-complete');
			}
			if (profile.solvedChalls.length >= contestXYZ.numChalls / 2) {
				await unlock(user.slackId, 'pwnyaa-xyz-half');
			}
		}
	};

	const postDaily = async () => {
		for (const contest of state.contests) {
			let someoneSolved = false;
			let text = '';
			text += `*${state.contests.find((con) => con.id === contest.id).title}*\n`;
			const allRecentSolves: {slackid: string, solves: SolvedInfo[]}[] = [];
			const users = contest.joiningUsers;
			for (const user of users) {
				const profile = await fetchUserProfile(user.idCtf, contest.id);
				if (profile !== null) {		// the user solved more than one challs
					const recentSolves = filterChallSolvedRecent(profile.solvedChalls, UPDATE_INTERVAL, true);
					allRecentSolves.push({slackid: user.slackId, solves: recentSolves});
					if (recentSolves.length > 0) {
						someoneSolved = true;
					}
				}
			}

			for (const solvePerUser of allRecentSolves) {
				for (const solve of solvePerUser.solves) {
					text += `<@${solvePerUser.slackid}> が *${solve.name}* (${solve.score})を解いたよ :pwn: \n`;
				}
			}
			if (someoneSolved) {
				slack.chat.postMessage({
					username: 'pwnyaa',
					icon_emoji: ':pwn',
					channel: process.env.CHANNEL_PWNABLE_TW,
					text,
				});
			}
		}
	};

	const postWeekly = async () => {
		let nobody = true;
		const ranks: { slackid: string, solves: number }[] = [];
		for (const contest of state.contests) {
			const users = contest.joiningUsers;
			for (const user of users) {
				const profile = await fetchUserProfile(user.idCtf, contest.id);
				const recentSolves = filterChallSolvedRecent(profile.solvedChalls, 7);
				if (recentSolves.length > 0) {		// solved more than one challs
					if (ranks.some((rank) => rank.slackid === user.slackId)) {
						const rankIndex = ranks.indexOf(ranks.find((rank) => rank.slackid === user.slackId));
						ranks[rankIndex].solves += recentSolves.length;
					} else {
						ranks.push({slackid: user.slackId, solves: recentSolves.length});
					}
					nobody = false;
				}
			}
		}

		ranks.sort((l, r) => r.solves - l.solves);
		let text = '';
		if (nobody) {
			text += '今週は誰も問題を解かなかったよ... :cry:\n';
		} else {
			text += '今週のpwnランキングを発表するよ〜\n';
			for (const [ix, user] of ranks.entries()) {
				text += `*${ix + 1}* 位: *${await getMemberName(user.slackid)}* \t\t*${user.solves}* solves \n`;
			}
			text += '\nおめでとう〜〜〜〜〜〜〜〜 :genius:\n';
		}

		slack.chat.postMessage({
			username: 'pwnyaa',
			icon_emoji: ':pwn',
			channel: process.env.CHANNEL_PWNABLE_TW,
			text,
		});
	};

	const updateAll = async () => {
		await updateChallsTW();
		await updateChallsXYZ();
		await checkAchievementsTW();
		await checkAchievementsXYZ();
	};

	// update the num of challs and achievements every 12 hours
	setInterval(() => {
		mutex.runExclusive(() => {
			updateAll();
			postDaily();
		});
	}, UPDATE_INTERVAL * HOUR);

	schedule.scheduleJob('0 9 * * 0', () => {
		mutex.runExclusive(() => {
			postWeekly();
		});
	});

	// init
	updateAll();
};
