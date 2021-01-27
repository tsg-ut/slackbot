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
import {fetchUserProfile, fetchChallsTW} from './lib/TWManager';
import {fetchChallsXYZ} from './lib/XYZManager';

const mutex = new Mutex();

const MINUTE = 60 * 1000;
const HOUR = MINUTE * 60;
const DAY = HOUR * 24;

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

const filterChallSolvedRecent = (challs: SolvedInfo[], day: number) => {
	const limitdate = Date.now() - day * DAY;
	const filteredChalls = challs.filter((chall) => chall.solvedAt.getTime() >= limitdate);
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
			id: 0,
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
			id: 1,
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
		if (message.text && message.subtype === undefined &&
      message.text.startsWith('@pwnyaa')) { // message is toward me
			const args = message.text.split(' ').slice(1);

			// show list of registered contests summary
			if (args[0] === 'list') {
				await postMessageDefault(message, {
					text: await (await Promise.all(state.contests.map(
						(contest) => getContestSummary(contest),
					))).join(''),
				});

				// join the contest
			} else if (args[0] === 'join') {
				const selectedContestName = args[1];
				const selectedUserIdCtf = args[2];
				const slackUserId = message.user;
				if (!selectedContestName || !selectedUserIdCtf) { // Command format is invalid
					await postMessageDefault(message, {
						text: stripIndent`
              *join* コマンド: ある常設CTFに登録する
                _join_  _<CTF name/alias>_  _<User ID>_
            `,
					});
				} else {
					const selectedContest =
						// eslint-disable-next-line max-len
						state.contests.find((contest) => contest.alias.some((alias) => alias === selectedContestName) || contest.title === selectedContestName);
					if (selectedContest) {		// add user to the contest and entire list
						if (!state.users.some((user) => slackUserId === user.slackId)) {
							setState({
								users: state.users.concat([{slackId: slackUserId, idCtf: ''}]),
							});
						}
						await addReactionDefault(message, 'ok');

						// check whether user exists on the CTF
						const userProfile = await fetchUserProfile(selectedUserIdCtf);
						if (userProfile) {
							await addUser2Ctf(message.user, selectedContest.id, selectedUserIdCtf);
							await postMessageDefault(message, {
								text: stripIndent`
								登録したよ! :azaika:
								ユーザ名  : ${userProfile.username}
								スコア   : ${userProfile.score}
								ランキング: ${userProfile.rank}
								${userProfile.comment}
								`,
							});
						} else {
							await postMessageDefault(message, {
								text: `ユーザ *${selectedUserIdCtf}* は *${selectedContest.title}* に見つからなかったよ:cry:`,
							});
						}
					} else { // specified contest is not registered
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
				}

				// check user status of the specified CTF.
			} else if (args[0] === 'check') {
				const selectedContestName = args[1];
				if (selectedContestName) {
					const user = getUser(message.user, selectedContestName);
					if (user) {
						const fetchedProfile = await fetchUserProfile(user.idCtf);
						await postMessageDefault(message, {
							text: stripIndent`
                *${fetchedProfile.username}* の情報だよ！スレッドを見てね。
              `,
						});
						await postMessageThreadDefault(message, {
							text: `${`ユーザ名  : *${fetchedProfile.username}* \n` +
								`スコア   : *${fetchedProfile.score}* \n` +
								`ランキング: *${fetchedProfile.rank}* \n` +
								`${fetchedProfile.comment} \n` +
								'解いた問題: \n'}${getChallsSummary(fetchedProfile.solvedChalls, 2)}`,
						});
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
                _join_  _<CTF name/alias>_
            `,
					});
				}
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
		const contestTW = state.contests.find((contest) => contest.id === 0);
		for (const user of contestTW.joiningUsers) {
			const profile = await fetchUserProfile(user.idCtf);
			if (profile.solvedChalls.length >= contestTW.numChalls) {
				await unlock(user.slackId, 'pwnyaa-tw-complete');
			}
			if (profile.solvedChalls.length >= contestTW.numChalls / 2) {
				await unlock(user.slackId, 'pwnyaa-tw-halr');
			}
		}
	};

	const postDaily = async () => {
		// for now, retrieve only TW.
		let someoneSolved = false;
		for (const contest of state.contests) {
			let text = '';
			if (contest.id === 0) { // TW
				text += `*${state.contests.find((contest) => contest.id === 0).title}*\n`;
				const allRecentSolves: {slackid: string, solves: SolvedInfo[]}[] = [];
				const users = contest.joiningUsers;
				for (const user of users) {
					const profile = await fetchUserProfile(user.idCtf);
					const recentSolves = filterChallSolvedRecent(profile.solvedChalls, 1);
					allRecentSolves.push({slackid: user.slackId, solves: recentSolves});
					if (recentSolves.length > 0) {
						someoneSolved = true;
					}
				}

				for (const solvePerUser of allRecentSolves) {
					for (const solve of solvePerUser.solves) {
						text += `*${solvePerUser.slackid}* が *${solve.name}* (${solve.score})を解いたよ :pwn: \n`;
					}
				}
				if (someoneSolved) {
					slack.chat.postMessage({
						username: 'pwnyaa',
						icon_emoji: ':pwn',
						channel: process.env.CHANNEL_TW,
						text,
					});
				}
			}
		}

		await checkAchievementsTW();
	};

	const postWeekly = async () => {
		// for now, retrieve only TW.
		let nobody = true;
		const ranks: { slackid: string, solves: number }[] = [];
		for (const contest of state.contests) {
			if (contest.id === 0) { // TW
				const users = contest.joiningUsers;
				for (const user of users) {
					const profile = await fetchUserProfile(user.idCtf);
					const recentSolves = filterChallSolvedRecent(profile.solvedChalls, 7);
					ranks.push({slackid: user.slackId, solves: recentSolves.length});
					if (recentSolves.length > 0) {
						nobody = false;
					}
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
				text += `*${ix + 1}* 位: *${user.slackid}* \t\t${user.solves} solves \n`;
			}
			text += '\nおめでとう〜〜〜〜〜〜〜〜 :genius:\n';
		}

		slack.chat.postMessage({
			username: 'pwnyaa',
			icon_emoji: ':pwn',
			channel: process.env.CHANNEL_TW,
			text,
		});
	};

	// update the num of challs every 12 hours
	setInterval(() => {
		mutex.runExclusive(() => {
			updateChallsTW();
			updateChallsTW();
		});
	}, 12 * HOUR);

	// init
	updateChallsTW();
	updateChallsXYZ();

	// set schedules
	schedule.scheduleJob('0 9 * * *', () => {
		mutex.runExclusive(() => {
			postDaily();
		});
	});

	schedule.scheduleJob('0 9 * * 0', () => {
		mutex.runExclusive(() => {
			postWeekly();
		});
	});
};
