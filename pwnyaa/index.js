"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AH_ID = exports.KSN_ID = exports.CH_ID = exports.XYZ_ID = exports.TW_ID = void 0;
const fs_1 = require("fs");
const path_1 = __importDefault(require("path"));
const async_mutex_1 = require("async-mutex");
const common_tags_1 = require("common-tags");
const node_schedule_1 = __importDefault(require("node-schedule"));
const index_js_1 = require("../achievements/index.js");
const logger_1 = __importDefault(require("../lib/logger"));
const slackUtils_1 = require("../lib/slackUtils");
const AHManager_1 = require("./lib/AHManager");
const BasicTypes_1 = require("./lib/BasicTypes");
const CHManager_1 = require("./lib/CHManager");
const KSNManager_1 = require("./lib/KSNManager");
const TWManager_1 = require("./lib/TWManager");
const XYZManager_1 = require("./lib/XYZManager");
const log = logger_1.default.child({ bot: 'pwnyaa' });
const mutex = new async_mutex_1.Mutex();
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
};
exports.TW_ID = 0;
exports.XYZ_ID = 1;
exports.CH_ID = 2;
exports.KSN_ID = 3;
exports.AH_ID = 4;
const CONTESTS = [
    { url: 'https://pwnable.xyz', id: exports.XYZ_ID, title: 'pwnable.xyz', alias: ['xyz', 'pnwable.xyz'], achievementType: BasicTypes_1.AchievementType.RATIO, achievementStr: 'xyz', fetchUserProfile: XYZManager_1.fetchUserProfileXYZ, findUserByName: XYZManager_1.findUserByNameXYZ, fetchChalls: XYZManager_1.fetchChallsXYZ, numChalls: 0, joiningUsers: [] },
    { url: 'https://pwnable.tw', id: exports.TW_ID, title: 'pwnable.tw', alias: ['tw', 'pwnable.tw'], achievementType: BasicTypes_1.AchievementType.RATIO, achievementStr: 'tw', fetchUserProfile: TWManager_1.fetchUserProfileTW, findUserByName: TWManager_1.findUserByNameTW, fetchChalls: TWManager_1.fetchChallsTW, numChalls: 0, joiningUsers: [] },
    { url: 'https://cryptohack.org', id: exports.CH_ID, title: 'cryptohack', alias: ['cryptohack', 'ch'], achievementType: BasicTypes_1.AchievementType.RATIO, achievementStr: 'ch', fetchUserProfile: CHManager_1.fetchUserProfileCH, findUserByName: CHManager_1.findUserByNameCH, fetchChalls: CHManager_1.fetchChallsCH, numChalls: 0, joiningUsers: [] },
    { url: 'https://ksnctf.sweetduet.info', id: exports.KSN_ID, title: 'ksnctf', alias: ['ksn', 'ksnctf'], achievementType: BasicTypes_1.AchievementType.RATIO, achievementStr: 'ksn', fetchUserProfile: KSNManager_1.fetchUserProfileKSN, findUserByName: KSNManager_1.findUserByNameKSN, fetchChalls: KSNManager_1.fetchChallsKSN, numChalls: 0, joiningUsers: [] },
    { url: 'https://alpacahack.com', id: exports.AH_ID, title: 'AlpacaHack', alias: ['ah', 'alpacahack', 'alpaca'], achievementType: BasicTypes_1.AchievementType.COUNT, achievementStr: 'ah', fetchUserProfile: AHManager_1.fetchUserProfileAH, findUserByName: AHManager_1.findUserByNameAH, fetchChalls: AHManager_1.fetchChallsAH, numChalls: 0, joiningUsers: [] },
];
const UPDATE_INTERVAL = 12;
// print as JST
const getPrintableDate = (date) => {
    let strdate = '';
    const jstdate = new Date(date);
    jstdate.setUTCHours(jstdate.getUTCHours() + 9);
    strdate += `${jstdate.getUTCFullYear()}/${jstdate.getUTCMonth() + 1}/${jstdate.getUTCDate()} `;
    strdate += `${jstdate.getUTCHours()}:${jstdate.getUTCMinutes()}`;
    return strdate;
};
const getContestColor = (ctfId) => {
    switch (ctfId) {
        case exports.XYZ_ID:
            return '#ff66ff';
        case exports.TW_ID:
            return '#ffff00';
        case exports.CH_ID:
            return '#0099ff';
        case exports.KSN_ID:
            return '#99cc00';
        case exports.AH_ID:
            return '#873e23';
        default:
            return '#000000';
    }
};
const getSolveColor = (solveNum) => {
    if (solveNum === 1) {
        return '#336699';
    }
    else if (2 <= solveNum && solveNum <= 3) {
        return '#00ffcc';
    }
    else if (4 <= solveNum && solveNum <= 5) {
        return '#ffcc00';
    }
    else if (6 <= solveNum && solveNum <= 7) {
        return '#ff6666';
    }
    else if (solveNum >= 8) {
        return '#cc0000';
    }
    return '#000000';
};
const getScoreColor = (score) => {
    if (score <= 10) {
        return '#336699';
    }
    else if (10 < score && score <= 50) {
        return '#00ffcc';
    }
    else if (50 < score && score <= 100) {
        return '#ffcc00';
    }
    else if (100 < score && score <= 300) {
        return '#ff6666';
    }
    return '#cc0000';
};
const getContestSummary = async (contest) => {
    let text = '';
    if (contest.joiningUsers.length === 0) {
        text += '  参加者: なし\n';
    }
    else {
        text += `  参加者: ${contest.joiningUsers.length}匹\n    `;
        for (const user of contest.joiningUsers) {
            text += `${await (0, slackUtils_1.getMemberName)(user.slackId)}   `;
        }
        text += '\n';
    }
    return {
        color: getContestColor(contest.id),
        author_name: contest.title,
        author_link: contest.url,
        text,
        footer: `問題数: ${contest.numChalls}`,
    };
};
const filterChallSolvedRecent = (challs, solvedIn, granular) => {
    let limitdate = 0;
    if (granular === DateGran.MSECOND) {
        limitdate = Date.now() - solvedIn;
    }
    else if (granular === DateGran.MINUTE) {
        limitdate = Date.now() - solvedIn * MINUTE;
    }
    else if (granular === DateGran.SECOND) {
        limitdate = Date.now() - solvedIn * 1000;
    }
    else if (granular === DateGran.HOUR) {
        limitdate = Date.now() - solvedIn * HOUR;
    }
    else if (granular === DateGran.DAY) {
        limitdate = Date.now() - solvedIn * DAY;
    }
    const filteredChalls = challs.filter((chall) => limitdate <= chall.solvedAt.getTime() && chall.solvedAt.getTime() <= Date.now());
    return filteredChalls;
};
const getChallsSummary = (challs) => challs.map((chall) => ({
    color: getScoreColor(chall.score),
    author_name: `${chall.name}: (${chall.score})`,
    footer: getPrintableDate(chall.solvedAt),
}));
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
exports.default = async ({ eventClient, webClient: slack }) => {
    let pendingUsers = [];
    // Restore state
    const statePath = path_1.default.resolve(__dirname, 'state.json');
    const exists = await fs_1.promises.access(statePath, fs_1.constants.F_OK)
        .then(() => true).catch(() => false);
    const state = {
        users: [],
        contests: [],
        ...(exists ? JSON.parse((await fs_1.promises.readFile(statePath)).toString()) : {}),
    };
    await fs_1.promises.writeFile(statePath, JSON.stringify(state));
    const setState = (object) => {
        Object.assign(state, object);
        return fs_1.promises.writeFile(statePath, JSON.stringify(state));
    };
    // Check achievement 'pwnyaa-praise-your-birthday'
    for (const user of state.users) {
        await (0, index_js_1.unlock)(user.slackId, 'pwnyaa-praise-your-birthday');
    }
    const getRanking = (solvesAllCtfs) => {
        const ranks = [];
        // parse profiles
        for (const contest of solvesAllCtfs) {
            for (const solvePerUser of contest.solves) {
                if (solvePerUser.solves.length > 0) {
                    if (ranks.some((rank) => rank.slackid === solvePerUser.slackid)) {
                        const rankIndex = ranks.indexOf(ranks.find((rank) => rank.slackid === solvePerUser.slackid));
                        ranks[rankIndex].solves += solvePerUser.solves.length;
                    }
                    else {
                        ranks.push({ slackid: solvePerUser.slackid, solves: solvePerUser.solves.length });
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
                }
                else {
                    ranks.push({ slackid: user.slackId, solves: user.selfSolvesWeekly });
                }
            }
        }
        ranks.sort((l, r) => r.solves - l.solves);
        return ranks;
    };
    // get solve-status from last Saturday 10:00 to today
    const postStatSummary = async (message) => {
        // ** post solve state of this week **
        let text = '*==今週のsolve状況だよ!==*';
        let attachments = [];
        // fetch each solve status
        const recentSolvesAllCtfs = await fetchRecentSolvesAll(Date.now() - getLastUpdateDate().getTime(), DateGran.MSECOND);
        // count for each CTFs
        for (const recentSolvesPerContest of recentSolvesAllCtfs) {
            let someoneSolved = false;
            const { idCtf, solves } = recentSolvesPerContest;
            const nameCtf = state.contests.find((contest) => contest.id === idCtf).title;
            const urlCtf = state.contests.find((contest) => contest.id === idCtf).url;
            let textCtf = '';
            for (const solvePerUser of solves) {
                if (solvePerUser.solves.length !== 0) {
                    const username = await (0, slackUtils_1.getMemberName)(solvePerUser.slackid);
                    for (const solve of solvePerUser.solves) {
                        textCtf += ` ${username}: ${solve.name}\n`;
                    }
                    someoneSolved = true;
                }
            }
            if (!someoneSolved) {
                textCtf += ' 誰も解いてないぽよ... :cry:';
            }
            attachments.push({
                color: getContestColor(idCtf),
                author_name: nameCtf,
                author_link: urlCtf,
                text: textCtf,
            });
        }
        // also, count for selfe-solves
        let textCtf = '';
        let someoneSolved = false;
        for (const user of state.users) {
            if (user.selfSolvesWeekly) {
                // eslint-disable-next-line no-unused-vars
                for (const _ of [...Array(user.selfSolvesWeekly).keys()]) {
                    const username = await (0, slackUtils_1.getMemberName)(user.slackId);
                    someoneSolved = true;
                    textCtf += ` ${username}: self-solve \n`;
                }
            }
        }
        if (!someoneSolved) {
            textCtf += ' 誰も解いてないぽよ... :cry:';
        }
        attachments.push({
            author_name: 'self-solve',
            color: '#6600ff',
            text: textCtf,
        });
        // post
        await postMessageThreadDefault(message, {
            text,
            attachments,
        });
        text = '';
        attachments = [];
        // ** post ranking **
        const ranks = getRanking(recentSolvesAllCtfs);
        text += '*==暫定ランキングだよ!==*';
        if (ranks.length > 0) {
            for (const [ix, user] of ranks.entries()) {
                const streak = state.users.find((u) => u.slackId === user.slackid).currentStreak;
                const attachment = {
                    color: getSolveColor(user.solves),
                    author_name: `${await (0, slackUtils_1.getMemberName)(user.slackid)}: ${ix + 1}位 (${user.solves} solves)`,
                    author_icon: await (0, slackUtils_1.getMemberIcon)(user.slackid),
                    footer: `${streak ? streak : 0} streaks`,
                };
                attachments.push(attachment);
            }
        }
        else {
            attachments.push({
                color: '#000000',
                text: '誰も解いてないからみんな1位だよ！！平和だね！',
            });
        }
        // post
        await postMessageThreadDefault(message, {
            text,
            attachments,
        });
        text = '';
        attachments = [];
        // fetch streaks
        text += '*==LongestStreaksの状況だよ!==*';
        for (const user of state.users) {
            if (user.longestStreak && user.longestStreak >= 1) {
                attachments.push({
                    color: getSolveColor(user.longestStreak),
                    author_name: await (0, slackUtils_1.getMemberName)(user.slackId),
                    author_icon: await (0, slackUtils_1.getMemberIcon)(user.slackId),
                    text: String(user.longestStreak) + (user.longestStreak === user.currentStreak ? ' (更新中!)' : ''),
                    footer: `current streaks: ${user.currentStreak ? user.currentStreak : 0}`,
                });
            }
        }
        if (attachments.length === 0) {
            attachments.push({
                color: '#000000',
                author_name: 'No Streaks',
                text: 'みんな0-streaksだよ。悲しいね。',
            });
        }
        await postMessageThreadDefault(message, {
            text,
            attachments,
        });
    };
    // post usage text. *args* starts right before @pwnyaa
    const resolveUsageMessage = async (args, slackMessage) => {
        if (args.length !== 2) { // format is invalid
            await postMessageThreadDefault(slackMessage, {
                text: (0, common_tags_1.stripIndent) `
					usage/helpコマンドのフォーマットが違うよ... :cry:
					*format* : _<command name> help_
				`,
            });
        }
        else {
            if (args[1] === 'check') {
                await postMessageThreadDefault(slackMessage, {
                    text: (0, common_tags_1.stripIndent) `
						*check* コマンド: 現在のsolve状況を確認する

						_check_ <CTF name>: 自分のsolve状況を確認する
						_check_ <CTF name> <slack name> : 他人のsolve状況を確認する(非メンション)
					`,
                });
            }
            else if (args[1] === 'join') {
                await postMessageThreadDefault(slackMessage, {
                    text: (0, common_tags_1.stripIndent) `
						*join* コマンド: 常設CTFへの参加を宣言する

						_join_ <CTF name> <user ID>: そのCTFにおけるuser IDを直接指定して参加登録する
						_join_ <CTF name> name=<username>: そのCTFにおけるuser nameを指定して参加登録する
						*WARNING* : 名前による検索はクロールコストを伴うため頻繁には行わないでください。
					`,
                });
            }
            else if (args[1] === 'list') {
                await postMessageThreadDefault(slackMessage, {
                    text: (0, common_tags_1.stripIndent) `
						*list* コマンド: 現在登録されている常設CTFを確認する

						_list_ : CTFのリストを確認する
					`,
                });
            }
            else if (args[1] === 'pwn') {
                await postMessageThreadDefault(slackMessage, {
                    text: (0, common_tags_1.stripIndent) `
						*pwn* コマンド: 常設CTF以外の問題を解いたことを宣言する

						_pwn_ <chall name>: 解いたことを宣言
						*補足* : 自己宣言した問題は毎週のランキングにおけるsolve数に加算されます
					`,
                });
            }
            else if (args[1] === 'stat') {
                await postMessageThreadDefault(slackMessage, {
                    text: (0, common_tags_1.stripIndent) `
						*stat* コマンド: 諸々のsolve状況等を確認する

						_stat_ : 今週のsolve状況と暫定ランキングを確認
					`,
                });
            }
            else {
                await postMessageThreadDefault(slackMessage, {
                    text: (0, common_tags_1.stripIndent) `
						*${args[1]}* は登録されてないコマンドだよ... :cry:
						_help_ コマンドで一覧を確認してね!
					`,
                });
            }
        }
    };
    const getSlackidByName = async (name) => {
        const candidates = state.users;
        for (const user of candidates) {
            if (await (0, slackUtils_1.getMemberName)(user.slackId) === name) {
                return user.slackId;
            }
        }
        return null;
    };
    const resolvePendingUser = (thread_ts) => {
        const requestingUser = pendingUsers.filter((user) => user.threadId === thread_ts)[0];
        const requestingUserIndex = pendingUsers.indexOf(requestingUser);
        if (requestingUserIndex > -1) {
            pendingUsers.splice(requestingUserIndex, 1);
            return requestingUser;
        }
        return null;
    };
    const setPendingUser = (slackid, contestid, contestUserId, threadId) => {
        pendingUsers = pendingUsers.map((user) => user.slackid === slackid && user.contestid === contestid
            ? { slackid, contestid, contestUserId, threadId } : user);
        if (!pendingUsers.some((user) => user.slackid === slackid && user.contestid === contestid)) {
            pendingUsers.push({ slackid, contestid, contestUserId, threadId });
        }
    };
    // eslint-disable-next-line require-await
    const findUserByName = async (name, contestid) => {
        const contest = state.contests.find((c) => c.id === contestid);
        return contest ? contest.findUserByName(name) : null;
    };
    // eslint-disable-next-line require-await
    const fetchUserProfile = async (userid, contestid) => {
        const contest = state.contests.find((c) => c.id === contestid);
        return contest ? contest.fetchUserProfile(userid) : null;
    };
    // get User of slackid from contest name
    const getUser = (slackid, contestname) => {
        let found = null;
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
    const addUser2Ctf = (slackId, ctfId, ctfUserId) => {
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
                    state.contests[ci].joiningUsers.push({ slackId, idCtf: ctfUserId });
                }
            }
        });
        (0, index_js_1.unlock)(slackId, 'pwnyaa-praise-your-birthday');
        setState(state);
    };
    const resolveSelfSolve = async (challName, slackMessage) => {
        const user = state.users.filter((user) => user.slackId === slackMessage.user);
        if (!user) { // user is not joining any CTFs
            await postMessageDefault(slackMessage, {
                text: (0, common_tags_1.stripIndent) `
					*${await (0, slackUtils_1.getMemberName)(slackMessage.user)}* はどのCTFにも参加してないよ :cry:
					まずは常設CTFのどれかに登録だけしてね!
				`,
            });
            return;
        }
        state.users.forEach((curUser, ci) => {
            if (curUser.slackId === slackMessage.user) {
                if (curUser.selfSolvesWeekly) {
                    state.users[ci].selfSolvesWeekly += 1;
                }
                else {
                    state.users[ci].selfSolvesWeekly = 1;
                }
            }
        });
        await setState(state);
        await postMessageDefault(slackMessage, {
            attachments: [{
                    color: getSolveColor(1),
                    author_name: await (0, slackUtils_1.getMemberName)(slackMessage.user),
                    author_icon: await (0, slackUtils_1.getMemberIcon)(slackMessage.user),
                    text: `${challName}(self) を解いたよ!`,
                    footer: 'self-solve',
                }],
        });
    };
    const resolveStreaks = async (solvesAllCtfs) => {
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
                }
                else {
                    state.users[ci].currentStreak = 1;
                    state.users[ci].longestStreak = 1;
                }
            }
            else {
                state.users[ci].currentStreak = 0;
            }
        });
        await setState(state);
    };
    // fetch data from TW and update state
    const updateChalls = async () => {
        for (const contest of CONTESTS) {
            const fetchedChalls = await contest.fetchChalls();
            const old = state.contests.find((c) => c.id === contest.id);
            const updated = {
                ...contest,
                joiningUsers: old ? old.joiningUsers : [],
                numChalls: fetchedChalls.length,
            };
            if (old) {
                state.contests = state.contests.map((c) => c.id === updated.id ? updated : c);
            }
            else {
                state.contests.push(updated);
            }
        }
        setState(state);
    };
    eventClient.on('message', async (message) => {
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
                            users: state.users.concat([{ slackId: message.user, idCtf: '' }]),
                        });
                    }
                    if (userProfile) {
                        addUser2Ctf(message.user, selectedContestId, selectedUserId);
                        await postMessageDefault(message, {
                            text: (0, common_tags_1.stripIndent) `
								登録したよ! :azaika:
								ユーザ名  : ${userProfile.username}
								スコア   : ${userProfile.score}
								ランキング: ${userProfile.rank}
								${userProfile.comment}
								<@${message.user}> よかったら#sig-pwnyaaにも参加してね!
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
            if (args.length === 0) {
                args.push('help');
            }
            // show list of registered contests summary
            if (args[0] === 'list') {
                await postMessageDefault(message, {
                    attachments: await (await Promise.all(state.contests.map((contest) => getContestSummary(contest)))),
                });
                /** ** END of list ****/
                // join the contest
            }
            else if (args[0] === 'join') {
                const selectedContestName = args[1];
                const selectedContest = 
                // eslint-disable-next-line max-len
                state.contests.find((contest) => contest.alias.some((alias) => alias === selectedContestName) || contest.title === selectedContestName);
                if (selectedContest) { // contest is found
                    if (args[2]) { // syntax is valid
                        await addReactionDefault(message, 'ok');
                        if (args[2].startsWith('name=')) { // check by name
                            const specifiedUsername = args[2].substring('name='.length);
                            const foundUser = await findUserByName(specifiedUsername, selectedContest.id);
                            if (foundUser) { // user is found on the contest
                                setPendingUser(message.user, selectedContest.id, foundUser.userid, message.ts);
                                await postMessageThreadDefault(message, {
                                    text: (0, common_tags_1.stripIndent) `
									このユーザであってるかな...? OKならこのスレッドで:pwn:とコメントしてね!
									  *ユーザ名* : ${foundUser.name}
									  *ID* : ${foundUser.userid}
									`,
                                });
                            }
                            else { // user is not found on the contest
                                await postMessageDefault(message, {
                                    text: `ユーザ *${specifiedUsername}* は *${selectedContestName}* に見つからなかったよ:cry: (1問も解いていない場合には参加できない場合があるよ)`,
                                });
                            }
                        }
                        else { // check by ID
                            const selectedUserId = args[2];
                            const userProfile = await fetchUserProfile(selectedUserId, selectedContest.id);
                            if (userProfile) { // user is found on the contest
                                if (!state.users.some((user) => message.user === user.slackId)) {
                                    setState({
                                        users: state.users.concat([{ slackId: message.user, idCtf: '' }]),
                                    });
                                }
                                addUser2Ctf(message.user, selectedContest.id, selectedUserId);
                                await postMessageDefault(message, {
                                    text: (0, common_tags_1.stripIndent) `
										登録したよ! :azaika:
										ユーザ名  : ${userProfile.username}
										スコア   : ${userProfile.score}
										ランキング: ${userProfile.rank}
										${userProfile.comment}
										<@${message.user}> よかったら#sig-pwnyaaにも参加してね!
										`,
                                });
                            }
                            else { // user is not found on the contest
                                await postMessageDefault(message, {
                                    text: `ユーザID *${selectedUserId}* は *${selectedContestName}* に見つからなかったよ:cry:`,
                                });
                            }
                        }
                    }
                    else { // syntax is invalid
                        await postMessageDefault(message, {
                            text: (0, common_tags_1.stripIndent) `
								*join* コマンド: ある常設CTFに登録する
									_join_  _<CTF name/alias>_  _<UserID | name=USERNAME>_
							`,
                        });
                    }
                }
                else { // contest not found
                    await postMessageDefault(message, {
                        text: (0, common_tags_1.stripIndent) `
							コンテスト *${selectedContestName}* は見つからなかったよ...
							現在登録されてるコンテスト一覧を見てね!
						`,
                    });
                    await postMessageDefault(message, {
                        attachments: await (await Promise.all(state.contests.map((contest) => getContestSummary(contest)))),
                    });
                }
                /** ** END of join ****/
                // check user status of the specified CTF.
            }
            else if (args[0] === 'check') {
                const selectedContestName = args[1];
                if (selectedContestName) { // contest is found
                    let specifiedUserSlackid = null;
                    if (args.length === 3) {
                        specifiedUserSlackid = await getSlackidByName(args[2]);
                    }
                    else {
                        specifiedUserSlackid = message.user;
                    }
                    const user = getUser(specifiedUserSlackid, selectedContestName);
                    if (user) { // user is found local
                        // eslint-disable-next-line max-len
                        const selectedContest = state.contests.find((contest) => contest.alias.some((alias) => alias === selectedContestName) || contest.title === selectedContestName);
                        if (selectedContest) { // contest is found
                            const fetchedProfile = await fetchUserProfile(user.idCtf, selectedContest.id);
                            await postMessageThreadDefault(message, {
                                text: `${`ユーザ名  : *${fetchedProfile.username}* \n` +
                                    `スコア   : *${fetchedProfile.score}* \n` +
                                    `ランキング: *${fetchedProfile.rank}* \n` +
                                    `${fetchedProfile.comment} \n` +
                                    '解いた問題: \n'}`,
                                attachments: getChallsSummary(fetchedProfile.solvedChalls),
                            });
                        }
                        else { // contest is not found
                            await postMessageDefault(message, {
                                text: (0, common_tags_1.stripIndent) `
									コンテスト *${selectedContestName}* は見つからなかったよ...
									現在登録されてるコンテスト一覧を見てね!
								`,
                            });
                        }
                    }
                    else {
                        await postMessageDefault(message, {
                            text: (0, common_tags_1.stripIndent) `
							まだ *${selectedContestName}* に参加してないよ。 *join* コマンドで参加登録してね!
							`,
                        });
                    }
                }
                else {
                    await postMessageDefault(message, {
                        text: (0, common_tags_1.stripIndent) `
						*check* コマンド: あるCTFにおける自分のステータス確認
						_check_  _<CTF name/alias>_
						`,
                    });
                }
                /** ** END of check ****/
            }
            else if (args[0] === 'pwn') { // self solve declaration
                if (args.length <= 1) { // command format is invalid
                    await postMessageDefault(message, {
                        text: (0, common_tags_1.stripIndent) `
							*:pwn:* コマンド: 登録されている以外のCTFの問題を解いたことの自己宣言
							*format* : _:pwn:_ _<chall name>_
						`,
                    });
                }
                else { // command format is valid
                    // concatnate solved-chall name
                    let challName = '';
                    for (const partName of args.slice(1)) {
                        challName += ` ${partName}`;
                    }
                    challName = challName.slice(1);
                    await resolveSelfSolve(challName, message);
                }
                /** ** END of pwn ****/
            }
            else if (args[0] === 'help' || args[0] === 'usage') {
                if (args.length >= 2) {
                    await resolveUsageMessage(args, message);
                }
                else {
                    await postMessageThreadDefault(message, {
                        text: (0, common_tags_1.stripIndent) `
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
            }
            else if (args[0] === 'stat') {
                // it takes some time to fetch all information
                await addReactionDefault(message, 'ok');
                await postStatSummary(message);
                // unknown command
            }
            else {
                await postMessageDefault(message, { text: ':wakarazu:' });
            }
        }
    });
    const postMessageDefault = async (receivedMessage, config = {}) => {
        const postingConfig = {
            username: 'pwnyaa',
            icon_emoji: ':pwn:',
            channel: receivedMessage.channel,
            text: '',
            ...config,
        };
        await slack.chat.postMessage(postingConfig);
    };
    const addReactionDefault = async (receivedMessage, emoji) => {
        await slack.reactions.add({
            name: emoji,
            channel: receivedMessage.channel,
            timestamp: receivedMessage.ts,
        });
    };
    const postMessageThreadDefault = async (receivedMessage, config = {}) => {
        const postingConfig = {
            username: 'pwnyaa',
            icon_emoji: ':pwn:',
            channel: receivedMessage.channel,
            thread_ts: receivedMessage.ts,
            text: '',
            ...config,
        };
        await slack.chat.postMessage(postingConfig);
    };
    const checkAchievements = async () => {
        log.info('[+] pwnyaa: checking achievements...');
        for (const contest of state.contests) {
            for (const user of contest.joiningUsers) {
                const profile = await fetchUserProfile(user.idCtf, contest.id);
                if (!profile) {
                    return;
                }
                switch (contest.achievementType) {
                    case BasicTypes_1.AchievementType.RATIO:
                        if (profile.solvedChalls.length >= contest.numChalls) {
                            log.info(`[+] pwnyaa: unlocking: pwnyaa-${contest.achievementStr}-complete`);
                            await (0, index_js_1.unlock)(user.slackId, `pwnyaa-${contest.achievementStr}-complete`);
                        }
                        if (profile.solvedChalls.length >= contest.numChalls / 2) {
                            log.info(`[+] pwnyaa: unlocking: pwnyaa-${contest.achievementStr}-half`);
                            await (0, index_js_1.unlock)(user.slackId, `pwnyaa-${contest.achievementStr}-half`);
                        }
                        break;
                    case BasicTypes_1.AchievementType.COUNT:
                        const achievements_count = [50, 20, 10, 5];
                        for (const num of achievements_count) {
                            if (profile.solvedChalls.length >= num) {
                                log.info(`[+] pwnyaa: unlocking: pwnyaa-${contest.achievementStr}-${num}`);
                                await (0, index_js_1.unlock)(user.slackId, `pwnyaa-${contest.achievementStr}-${num}`);
                            }
                        }
                        break;
                }
            }
        }
    };
    // fetch challs of all CTFs solved recently
    const fetchRecentSolvesAll = async (solvedIn, granular) => {
        const recentSolvesAllCtfs = [];
        for (const contest of state.contests) {
            const allRecentSolves = [];
            for (const user of contest.joiningUsers) {
                const profile = await fetchUserProfile(user.idCtf, contest.id);
                if (profile !== null) {
                    const recentSolves = filterChallSolvedRecent(profile.solvedChalls, solvedIn, granular);
                    allRecentSolves.push({ slackid: user.slackId, solves: recentSolves });
                }
            }
            recentSolvesAllCtfs.push({ idCtf: contest.id, solves: allRecentSolves });
        }
        return recentSolvesAllCtfs;
    };
    const postProgress = async () => {
        log.info('[+] pwnyaa: progress posting...');
        let someoneSolved = false;
        const recentSolvesAllCtfs = await fetchRecentSolvesAll(UPDATE_INTERVAL, DateGran.HOUR);
        const attachments = [];
        for (const solvesPerContest of recentSolvesAllCtfs) {
            const nameCtf = state.contests.find((c) => solvesPerContest.idCtf === c.id).title;
            for (const solvesPerUser of solvesPerContest.solves) {
                for (const solve of solvesPerUser.solves) {
                    attachments.push({
                        color: getContestColor(solvesPerContest.idCtf),
                        author_name: await (0, slackUtils_1.getMemberName)(solvesPerUser.slackid),
                        author_icon: await (0, slackUtils_1.getMemberIcon)(solvesPerUser.slackid),
                        text: `${solve.name}(${solve.score}) を解いたよ!`,
                        footer: nameCtf,
                    });
                    someoneSolved = true;
                }
            }
        }
        if (someoneSolved) {
            log.info('[+] someone solved challs...');
            slack.chat.postMessage({
                username: 'pwnyaa',
                icon_emoji: ':pwn:',
                channel: process.env.CHANNEL_PWNABLE_TW,
                text: '',
                attachments,
            });
        }
    };
    const postWeekly = async () => {
        log.info('[+] pwnyaa: posting weekly...');
        // get ranking
        const recentSolvesAllCtfs = await fetchRecentSolvesAll(7, DateGran.DAY);
        const ranks = getRanking(recentSolvesAllCtfs);
        const attachments = [];
        // resolve streaks
        await resolveStreaks(recentSolvesAllCtfs);
        // gen text
        ranks.sort((l, r) => r.solves - l.solves);
        let text = '';
        if (ranks.length > 0) {
            text += '今週のpwnランキングを発表するよ〜\n';
            for (const [ix, user] of ranks.entries()) {
                const streak = state.users.find((u) => u.slackId === user.slackid).currentStreak;
                const attachment = {
                    color: getSolveColor(user.solves),
                    author_name: `${await (0, slackUtils_1.getMemberName)(user.slackid)}: ${ix + 1}位 (${user.solves} solves)`,
                    author_icon: await (0, slackUtils_1.getMemberIcon)(user.slackid),
                    footer: `${streak ? streak : 0} streaks`,
                };
                attachments.push(attachment);
            }
        }
        else {
            attachments.push({
                text: '今週は誰も問題を解かなかったよ... :cry:',
                color: '#000000',
            });
        }
        let streakText = '';
        for (const user of state.users) {
            if (user.longestStreak && user.longestStreak === user.currentStreak) {
                streakText += `:azaika-is-blue-coder: *${await (0, slackUtils_1.getMemberName)(user.slackId)}* がLongestStreakを更新したよ! *(${user.longestStreak} streak!)* \n`;
            }
        }
        attachments.push({
            text: streakText,
            color: '#ffccff',
        });
        slack.chat.postMessage({
            username: 'pwnyaa',
            icon_emoji: ':pwn:',
            channel: process.env.CHANNEL_PWNABLE_TW,
            text,
            attachments,
        });
        // clear self-solves count
        state.users = state.users.map((user) => {
            user.selfSolvesWeekly = 0;
            return user;
        });
        setState(state);
    };
    const updateAll = async () => {
        await updateChalls();
        await checkAchievements();
    };
    // update the num of challs and achievements every 12 hours
    setInterval(() => {
        mutex.runExclusive(() => {
            updateAll();
        });
    }, UPDATE_INTERVAL * HOUR);
    node_schedule_1.default.scheduleJob('0 9 * * 0', () => {
        mutex.runExclusive(() => {
            postWeekly();
        });
    });
    node_schedule_1.default.scheduleJob('0 10 * * *', () => {
        mutex.runExclusive(() => {
            postProgress();
        });
    });
    node_schedule_1.default.scheduleJob('0 22 * * *', () => {
        mutex.runExclusive(() => {
            postProgress();
        });
    });
    // init
    const initPromise = updateAll();
    return { initPromise };
};
