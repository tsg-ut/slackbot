"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.server = void 0;
const fastify_plugin_1 = __importDefault(require("fastify-plugin"));
const async_mutex_1 = require("async-mutex");
const common_tags_1 = require("common-tags");
const moment_1 = __importDefault(require("moment"));
const slackUtils_1 = require("../lib/slackUtils");
const logger_1 = __importDefault(require("../lib/logger"));
const state_1 = __importDefault(require("../lib/state"));
const achievements = __importStar(require("../achievements/index.js"));
const config_1 = __importDefault(require("./config"));
const views = __importStar(require("./views"));
const atcoder = __importStar(require("./atcoder"));
const anagol = __importStar(require("./anagol"));
const USERNAME = 'golfbot';
const ICON_EMOJI = ':golf:';
const log = logger_1.default.child({ bot: 'golfbot' });
const mutex = new async_mutex_1.Mutex();
const parseMessage = (text) => {
    let re;
    let match;
    // call
    re = /^@golfbot\b\s*/;
    match = re.exec(text);
    if (!match)
        return null;
    text = text.replace(re, '');
    // subcommand
    re = /^(?<subcommand>[a-z0-9-]+)\b\s*/i;
    match = re.exec(text);
    if (!match)
        return { type: 'none' };
    const { subcommand } = match.groups;
    text = text.replace(re, '');
    switch (subcommand) {
        case 'join': {
            re = /^(?<service>atcoder|anagol)\s+(?<username>.+?)\s*$/i;
            match = re.exec(text);
            if (!match) {
                return { type: 'error', message: `引数がおかしいよ`, subcommand: 'join' };
            }
            const { service, username } = match.groups;
            return { type: 'join', service, username };
        }
        case 'whoami': {
            return { type: 'whoami' };
        }
        case 'post': {
            return { type: 'post' };
        }
        case 'list': {
            return { type: 'list' };
        }
        case 'remove': {
            return { type: 'remove' };
        }
        case 'help': {
            re = /^(?<subcommand>[a-z0-9-]+)\s*$/i;
            match = re.exec(text);
            if (!match) {
                return { type: 'help' };
            }
            const { subcommand } = match.groups;
            return { type: 'help', subcommand };
        }
        default: {
            return {
                type: 'error',
                message: `「${subcommand}」は知らないコマンドだよ`,
            };
        }
    }
};
const help = (subcommand) => {
    switch (subcommand) {
        case 'join': {
            return (0, common_tags_1.stripIndent) `
				\`join\` : アカウント登録

				\`\`\`
				@golfbot join atcoder <username>
				@golfbot join anagol <username>
				\`\`\`
			`;
        }
        case 'post': {
            return (0, common_tags_1.stripIndent) `
				\`post\` : 問題投稿 (スラッシュコマンド)

				\`\`\`
				/golfbot post
				\`\`\`

				ダイアログが開くので、形式、問題 URL、開始日時、終了日時を入力してね！
			`;
        }
        default: {
            return (0, common_tags_1.stripIndent) `
				\`join\` : アカウント登録
				\`whoami\` : アカウント確認
				\`post\` : 問題投稿 (スラッシュコマンド)
				\`list\` : コンテスト一覧

				詳しい使い方は \`@golfbot help <subcommand>\` で聞いてね！
			`;
        }
    }
};
const formatContestTime = (contest) => {
    const start = (0, moment_1.default)(contest.startAt)
        .locale('ja')
        .format('YYYY-MM-DD (ddd) HH:mm');
    const end = (0, moment_1.default)(contest.endAt).format('HH:mm');
    const duration = Math.floor((contest.endAt - contest.startAt) / (60 * 1000));
    return `${start} ～ ${end} (${duration}分)`;
};
const getServiceName = (service) => {
    return config_1.default[service].name;
};
const getLanguageName = (service, languageId) => {
    return config_1.default[service].languages.find(l => l.id === languageId)?.name ?? '';
};
const createContestAttachment = async (contest, mode) => {
    // prepend `\u200a` to display language names starting with `>`, such as `><>`
    // https://stackoverflow.com/questions/46331295/how-to-display-a-greater-than-symbol-at-the-start-of-a-slack-attachment-line-wit
    switch (mode) {
        case 'owner': {
            return {
                fields: [
                    { title: '問題', value: contest.problem.url },
                    { title: '言語', value: '\u200a' + getLanguageName(contest.service, contest.language) },
                    { title: 'コンテスト時間', value: formatContestTime(contest) },
                ],
            };
        }
        case 'list': {
            return {
                fields: [
                    { title: '投稿者', value: await (0, slackUtils_1.getMemberName)(contest.owner) },
                    { title: '形式', value: getServiceName(contest.service) },
                    { title: '言語', value: '\u200a' + getLanguageName(contest.service, contest.language) },
                    { title: 'コンテスト時間', value: formatContestTime(contest) },
                ],
            };
        }
        case 'hidden': {
            return {
                fields: [
                    { title: '投稿者', value: `<@${contest.owner}>` },
                    { title: '形式', value: getServiceName(contest.service) },
                    { title: '言語', value: '\u200a' + getLanguageName(contest.service, contest.language) },
                    { title: 'コンテスト時間', value: formatContestTime(contest) },
                ],
            };
        }
        case 'revealed': {
            return {
                fields: [
                    { title: '投稿者', value: `<@${contest.owner}>` },
                    { title: '問題', value: contest.problem.url },
                    { title: '言語', value: '\u200a' + getLanguageName(contest.service, contest.language) },
                    { title: 'コンテスト時間', value: formatContestTime(contest) },
                ],
            };
        }
    }
};
const server = ({ eventClient, webClient: slack, messageClient: slackInteractions }) => (0, fastify_plugin_1.default)(async (fastify) => {
    const state = await state_1.default.init('golfbot', {
        users: [],
        contests: [],
    });
    // メッセージ呼び出し
    eventClient.on('message', async (message) => {
        const cmd = parseMessage(message.text);
        if (cmd === null) {
            return;
        }
        log.info(`[golfbot] command ${JSON.stringify(cmd)}`);
        switch (cmd.type) {
            case 'join': {
                let user = state.users.find(u => u.slackId === message.user);
                if (!user) {
                    state.users.push({
                        slackId: message.user,
                    });
                    // get observable object
                    user = state.users[state.users.length - 1];
                }
                if (cmd.service === 'atcoder') {
                    user.atcoderId = cmd.username;
                }
                if (cmd.service === 'anagol') {
                    user.anagolId = cmd.username;
                }
                await slack.reactions.add({
                    name: '+1',
                    channel: message.channel,
                    timestamp: message.ts,
                });
                return;
            }
            case 'whoami': {
                const user = state.users.find(u => u.slackId === message.user);
                await slack.chat.postMessage({
                    username: USERNAME,
                    icon_emoji: ICON_EMOJI,
                    channel: message.channel,
                    text: (0, common_tags_1.stripIndent) `
							${await (0, slackUtils_1.getMemberName)(message.user)} さんのアカウント
							AtCoder: ${user?.atcoderId ?? '登録なし'}
							Anarchy Golf: ${user?.anagolId ?? '登録なし'}
						`,
                });
                return;
            }
            case 'post': {
                await slack.chat.postMessage({
                    username: USERNAME,
                    icon_emoji: ICON_EMOJI,
                    channel: message.channel,
                    text: help('post'),
                });
                return;
            }
            case 'list': {
                await slack.chat.postMessage({
                    username: USERNAME,
                    icon_emoji: ICON_EMOJI,
                    channel: message.channel,
                    text: (0, common_tags_1.stripIndent) `
							${state.contests.length > 0 ? '現在のコンテスト一覧だよ' : '現在コンテストの予定は無いよ'}
						`,
                    attachments: await Promise.all(state.contests.map(contest => createContestAttachment(contest, 'list'))),
                });
                return;
            }
            case 'remove': {
                const prevLength = state.contests.length;
                state.contests = state.contests.filter(c => c.messageTs !== message.thread_ts);
                if (state.contests.length < prevLength) {
                    await slack.reactions.add({
                        name: '+1',
                        channel: message.channel,
                        timestamp: message.ts,
                    });
                    await slack.chat.postMessage({
                        username: USERNAME,
                        icon_emoji: ICON_EMOJI,
                        channel: process.env.CHANNEL_SIG_CODEGOLF,
                        text: (0, common_tags_1.stripIndent) `
								コンテストが削除されたよ :cry:
							`,
                    });
                }
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
    // スラッシュコマンド呼び出し
    const { team: tsgTeam } = await slack.team.info();
    fastify.post('/slash/golfbot', async (request, response) => {
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
        }
        else {
            return help('post');
        }
    });
    // 問題編集ボタン呼び出し
    slackInteractions.action({
        blockId: 'golfbot_edit',
        actionId: 'edit',
    }, (payload) => {
        mutex.runExclusive(async () => {
            const contest = state.contests.find(c => c.messageTs === payload.container.message_ts);
            if (!contest) {
                return;
            }
            await slack.views.open({
                trigger_id: payload.trigger_id,
                view: {
                    ...views.createPostView({
                        service: contest.service,
                        problemURL: contest.problem.url,
                        language: contest.language,
                        date: (0, moment_1.default)(contest.startAt).format('YYYY-MM-DD'),
                        startTime: (0, moment_1.default)(contest.startAt).format('HH:mm'),
                        endTime: (0, moment_1.default)(contest.endAt).format('HH:mm'),
                    }),
                    private_metadata: contest.messageTs,
                },
            });
        });
    });
    slackInteractions.action({
        blockId: 'golfbot_post_service',
    }, async (payload) => {
        const values = {
            ...views.getPostValues(payload.view.state.values),
            problemURL: undefined,
            language: undefined,
        };
        await slack.views.update({
            view_id: payload.view.id,
            view: {
                ...views.createPostView(values),
                private_metadata: payload.view.private_metadata,
            },
        });
    });
    // 問題投稿
    slackInteractions.viewSubmission({
        callbackId: 'golfbot_post',
    }, (payload) => {
        const values = views.getPostValues(payload.view.state.values);
        const now = Date.now();
        const today = (0, moment_1.default)(now).format('YYYY-MM-DD');
        const startAt = new Date(`${values.date} ${values.startTime}`).getTime();
        const endAt = new Date(`${values.date} ${values.endTime}`).getTime();
        if (!config_1.default[values.service].languages.some(l => l.id === values.language)) {
            return {
                response_action: 'errors',
                errors: {
                    golfbot_post_language: '言語がおかしいよ',
                },
            };
        }
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
        let problem;
        if (values.service === 'atcoder') {
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
            const { contestId, taskId } = match.groups;
            problem = {
                url: values.problemURL,
                contestId,
                taskId,
            };
        }
        if (values.service === 'anagol') {
            const re = /^http:\/\/golf\.shinh\.org\/p\.rb\?(?<problemId>\S+)$/i;
            const match = re.exec(values.problemURL);
            if (!match) {
                return {
                    response_action: 'errors',
                    errors: {
                        golfbot_post_problem_url: '問題 URL がおかしいよ',
                    },
                };
            }
            const { problemId } = match.groups;
            problem = {
                url: values.problemURL,
                problemId,
            };
        }
        const messageTs = payload.view.private_metadata;
        if (messageTs) {
            // コンテストを編集
            log.info(`[golfbot] edit ${JSON.stringify(values)}`);
            mutex.runExclusive(async () => {
                const contest = {
                    owner: payload.user.id,
                    messageTs,
                    service: values.service,
                    problem: problem,
                    language: values.language,
                    startAt,
                    endAt,
                    submissions: [],
                };
                const oldContest = state.contests.find(c => (c.messageTs === contest.messageTs ? contest : c));
                if (!oldContest) {
                    return;
                }
                // DM を更新
                const { channel } = await slack.conversations.open({
                    users: payload.user.id,
                });
                await slack.chat.update({
                    channel: channel.id,
                    ts: messageTs,
                    text: '',
                    attachments: [await createContestAttachment(contest, 'owner')],
                });
                state.contests = state.contests.map(c => (c.messageTs === contest.messageTs ? contest : c));
                // #sig-codegolf に送る
                await slack.chat.postMessage({
                    username: USERNAME,
                    icon_emoji: ICON_EMOJI,
                    channel: process.env.CHANNEL_SIG_CODEGOLF,
                    text: (0, common_tags_1.stripIndent) `
								コンテストが変更されたよ！
							`,
                    attachments: [await createContestAttachment(contest, 'hidden')],
                });
            });
        }
        else {
            // コンテストを追加
            log.info(`[golfbot] post ${JSON.stringify(values)}`);
            mutex.runExclusive(async () => {
                const contest = {
                    owner: payload.user.id,
                    messageTs: '',
                    service: values.service,
                    problem: problem,
                    language: values.language,
                    startAt,
                    endAt,
                    submissions: [],
                };
                // DM を送る
                const { channel } = await slack.conversations.open({
                    users: payload.user.id,
                });
                const message = await slack.chat.postMessage({
                    username: USERNAME,
                    icon_emoji: ICON_EMOJI,
                    channel: channel.id,
                    text: '',
                    blocks: [
                        {
                            type: 'section',
                            text: (0, slackUtils_1.mrkdwn)((0, common_tags_1.stripIndent) `
										コンテストを追加したよ！
										内容を編集するにはこのボタンを使ってね！
										コンテストを削除するにはこのメッセージに \`@golfbot remove\` とリプライしてね！
									`),
                        },
                        ...views.createEditBlocks(),
                    ],
                    attachments: [await createContestAttachment(contest, 'owner')],
                });
                contest.messageTs = message.ts;
                state.contests.push(contest);
                // #sig-codegolf に送る
                await slack.chat.postMessage({
                    username: USERNAME,
                    icon_emoji: ICON_EMOJI,
                    channel: process.env.CHANNEL_SIG_CODEGOLF,
                    text: (0, common_tags_1.stripIndent) `
								コンテストが追加されたよ！
							`,
                    attachments: [await createContestAttachment(contest, 'hidden')],
                });
            });
        }
        return {
            response_action: 'clear',
        };
    });
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
                            channel: process.env.CHANNEL_SIG_CODEGOLF,
                            text: (0, common_tags_1.stripIndent) `
									コンテストが始まったよ～ :golfer:
								`,
                            attachments: [await createContestAttachment(contest, 'revealed')],
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
                        const notifications = [];
                        if (contest.service === 'atcoder') {
                            const getShortests = (submissions) => {
                                const shortests = new Map();
                                for (const { userId, length } of submissions) {
                                    if (!shortests.has(userId) || shortests.get(userId) > length) {
                                        shortests.set(userId, length);
                                    }
                                }
                                return shortests;
                            };
                            const oldShortests = getShortests(contest.submissions);
                            const newSubmissions = await atcoder.crawlSubmissions(contest.problem.contestId, {
                                language: contest.language,
                                status: 'AC',
                                task: contest.problem.taskId,
                                since: new Date(contest.startAt),
                                until: new Date(contest.endAt),
                            });
                            const newShortests = getShortests(newSubmissions);
                            for (const [atcoderId, newLength] of newShortests.entries()) {
                                if (oldShortests.has(atcoderId) && oldShortests.get(atcoderId) <= newLength) {
                                    continue;
                                }
                                notifications.push({
                                    user: atcoderId,
                                    from: oldShortests.get(atcoderId) ?? Infinity,
                                    to: newLength,
                                });
                            }
                            contest.submissions = newSubmissions;
                        }
                        if (contest.service === 'anagol') {
                            const newSubmissions = (await anagol.crawlStandings(contest.problem.problemId, contest.language)).filter(submission => {
                                return contest.startAt <= submission.date.getTime() && submission.date.getTime() < contest.endAt;
                            });
                            for (const submission of newSubmissions) {
                                const oldUserSubmission = contest.submissions.find(s => s.user === submission.user);
                                if (oldUserSubmission && oldUserSubmission.size <= submission.size) {
                                    continue;
                                }
                                notifications.push({
                                    user: submission.user,
                                    from: oldUserSubmission?.size ?? Infinity,
                                    to: submission.size,
                                });
                            }
                            contest.submissions = newSubmissions;
                        }
                        for (const { user, from, to } of notifications) {
                            await slack.chat.postMessage({
                                username: USERNAME,
                                icon_emoji: ICON_EMOJI,
                                channel: process.env.CHANNEL_SIG_CODEGOLF,
                                text: Number.isFinite(from)
                                    ? (0, common_tags_1.stripIndent) `
											*${user}* がコードを短縮しました！ (*${from} Byte* → *${to} Byte*)
										`
                                    : (0, common_tags_1.stripIndent) `
											*${user}* が :ac: しました！ (*${to} Byte*)
										`,
                            });
                        }
                    }
                    // ちょうど終了のコンテスト
                    if (oldTime < contest.endAt && contest.endAt <= newTime) {
                        const attachments = [];
                        const participants = [];
                        if (contest.service === 'atcoder') {
                            const standings = atcoder.computeStandings(contest.submissions);
                            for (const { userId: atcoderId, submission } of standings) {
                                const user = state.users.find(u => u.atcoderId === atcoderId);
                                const code = await atcoder.crawlSourceCode(contest.problem.contestId, submission.id);
                                attachments.push({
                                    mrkdwn_in: ['text'],
                                    author_name: `${user ? await (0, slackUtils_1.getMemberName)(user.slackId) : submission.userId}: ${submission.length} Byte`,
                                    author_icon: user ? await (0, slackUtils_1.getMemberIcon)(user.slackId) : undefined,
                                    author_link: `https://atcoder.jp/contests/${contest.problem.contestId}/submissions/${submission.id}`,
                                    text: `\`\`\`${code}\`\`\``,
                                    footer: `提出: ${(0, moment_1.default)(submission.time).format('HH:mm:ss')}`,
                                });
                                if (user) {
                                    participants.push(user.slackId);
                                }
                            }
                        }
                        if (contest.service === 'anagol') {
                            const languageName = getLanguageName('anagol', contest.language);
                            for (const submission of contest.submissions) {
                                const user = state.users.find(u => u.anagolId === submission.user);
                                const code = submission.url && (await anagol.crawlSourceCode(submission.url));
                                attachments.push({
                                    mrkdwn_in: ['text'],
                                    author_name: `${user ? await (0, slackUtils_1.getMemberName)(user.slackId) : submission.user}: ${submission.size} Byte`,
                                    author_icon: user ? await (0, slackUtils_1.getMemberIcon)(user.slackId) : undefined,
                                    author_link: `http://golf.shinh.org/p.rb?${contest.problem.problemId}#${languageName}`,
                                    text: code ? `\`\`\`${code}\`\`\`` : '(hidden)',
                                    footer: `提出: ${(0, moment_1.default)(submission.date).format('HH:mm:ss')}`,
                                });
                                if (user) {
                                    participants.push(user.slackId);
                                }
                            }
                        }
                        await slack.chat.postMessage({
                            username: USERNAME,
                            icon_emoji: ICON_EMOJI,
                            channel: process.env.CHANNEL_SIG_CODEGOLF,
                            text: (0, common_tags_1.stripIndent) `
									お疲れさまでした！

									${attachments.length === 0 ? '今回は :ac: した人がいなかったよ :cry:' : ''}
								`,
                            attachments,
                        });
                        await achievements.increment(contest.owner, 'golfbot-host');
                        for (const user of participants) {
                            await achievements.increment(user, 'golfbot-participate');
                        }
                    }
                }
                // 終了したコンテストを削除
                // stateへの書き込みを抑制するため、終了したコンテストが存在する場合のみ実行する
                if (state.contests.some(contest => contest.endAt <= newTime)) {
                    state.contests = state.contests.filter(contest => !(contest.endAt <= newTime));
                }
            });
        }, 30 * 1000);
    }
});
exports.server = server;
