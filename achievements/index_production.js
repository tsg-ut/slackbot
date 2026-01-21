"use strict";
/* eslint-disable @typescript-eslint/no-use-before-define */
/* eslint-disable no-restricted-syntax */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.set = exports.get = exports.increment = exports.isUnlocked = exports.lock = exports.unlock = void 0;
const async_mutex_1 = require("async-mutex");
const common_tags_1 = require("common-tags");
// @ts-expect-error: Not typed
const japanese_1 = __importDefault(require("japanese"));
const lodash_1 = require("lodash");
const moment_1 = __importDefault(require("moment"));
const firestore_1 = require("../lib/firestore");
// @ts-expect-error: Not typed
const getReading_1 = __importDefault(require("../lib/getReading"));
const logger_1 = __importDefault(require("../lib/logger"));
const slackPatron_1 = require("../lib/slackPatron");
const slackUtils_1 = require("../lib/slackUtils");
const state_1 = require("../lib/state");
const utils_1 = require("../lib/utils");
const achievements_1 = __importDefault(require("./achievements"));
const mutex = new async_mutex_1.Mutex();
const log = logger_1.default.child({ bot: 'achievements' });
const state = {
    users: new Map(),
    achievements: new Map(),
};
const difficultyToStars = (difficulty) => ({
    baby: '★☆☆☆☆',
    easy: '★★☆☆☆',
    medium: '★★★☆☆',
    hard: '★★★★☆',
    professional: '★★★★★',
}[difficulty]);
const loadDeferred = new utils_1.Deferred();
const initializeDeferred = new utils_1.Deferred();
const unlockReactionCountAchievements = async (event) => {
    if (!event.item.channel.startsWith('C')) {
        return;
    }
    const reactions = await (0, slackUtils_1.getReactions)(event.item.channel, event.item.ts);
    const reactedUsers = reactions[event.reaction] || [];
    const messageURL = event.item.type === 'message'
        ? `<https://tsg-ut.slack.com/archives/${event.item.channel}/p${event.item.ts.replace('.', '')}|[メッセージ]>`
        : '';
    if (reactedUsers.length >= 1) {
        const firstReactedUser = reactedUsers[0];
        for (const threshold of [5, 10, 15, 20, 25, 30, 35, 40, 45, 50]) {
            if (reactedUsers.length >= threshold) {
                const messagesKey = `reaction-${event.reaction}-${threshold}-messages`;
                const counterName = `reaction-${event.reaction}-${threshold}`;
                const firstReactionMessagesKey = `reaction-${event.reaction}-${threshold}-first-reaction-messages`;
                const firstReactionCounterName = `reaction-${event.reaction}-${threshold}-first-reaction`;
                mutex.runExclusive(async () => {
                    const messages = (await (0, exports.get)(event.item_user, messagesKey)) || [];
                    if (!Array.isArray(messages)) {
                        log.error(`Invalid reaction messages for ${event.item_user} on ${messagesKey}: ${JSON.stringify(messages)}`);
                        return;
                    }
                    if (!messages.includes(event.item.ts)) {
                        await (0, exports.set)(event.item_user, messagesKey, [...messages, event.item.ts]);
                        await (0, exports.increment)(event.item_user, counterName, 1, messageURL);
                        await (0, exports.increment)(event.item_user, `reaction-${threshold}-reactions`, 1, messageURL);
                    }
                    const firstReactionMessages = (await (0, exports.get)(firstReactedUser, firstReactionMessagesKey)) || [];
                    if (!Array.isArray(firstReactionMessages)) {
                        log.error(`Invalid reaction messages for ${firstReactedUser} on ${firstReactionMessagesKey}: ${JSON.stringify(firstReactionMessages)}`);
                        return;
                    }
                    if (!firstReactionMessages.includes(event.item.ts)) {
                        await (0, exports.set)(firstReactedUser, firstReactionMessagesKey, [...firstReactionMessages, event.item.ts]);
                        await (0, exports.increment)(firstReactedUser, firstReactionCounterName, 1, messageURL);
                        await (0, exports.increment)(firstReactedUser, `reaction-${threshold}-reactions-first-reaction`, 1, messageURL);
                    }
                });
            }
        }
    }
};
const kiToOAchievementsCache = new Set();
const unlockKiToOAchievements = async (event) => {
    if (!event.item.channel.startsWith('C')) {
        return;
    }
    let mode = null;
    if (event.reaction.startsWith('o')) {
        mode = 'ki-to-o';
    }
    else if (event.reaction.startsWith('ki')) {
        mode = 'o-to-ki';
    }
    if (mode === null) {
        return;
    }
    if (event.item_user === event.user) {
        log.info(`Skipping self-reaction for ${event.reaction} on ${event.item.channel} at ${event.item.ts}`);
        return;
    }
    const normalizedReaction = event.reaction.toLowerCase().replaceAll(/[^a-z]/g, '');
    const cacheKey = `${event.item.channel}-${event.item.ts}-${event.reaction}-${event.user}`;
    if (kiToOAchievementsCache.has(cacheKey)) {
        log.info(`Skipping already processed reaction ${event.reaction} on ${event.item.channel} at ${event.item.ts} for user ${event.user}`);
        return;
    }
    kiToOAchievementsCache.add(cacheKey);
    // Add delay here to allow slack-patron to cache the reaction data
    await new Promise((resolve) => {
        setTimeout(resolve, 5000);
    });
    await mutex.runExclusive(async () => {
        const messageData = await (0, slackPatron_1.conversationsHistory)({
            channel: event.item.channel,
            latest: event.item.ts,
            limit: 1,
            inclusive: true,
        });
        const message = messageData?.messages?.[0];
        const reactedUsers = message?.reactions?.find((r) => r.name === event.reaction)?.users || [];
        if (!message || !message.text) {
            log.warn(`No message found for reaction ${event.reaction} on ${event.item.channel} at ${event.item.ts}`);
            return;
        }
        const reading = await (0, getReading_1.default)(message.text);
        if (typeof reading !== 'string') {
            log.warn(`No reading found for message ${message.text}`);
            return;
        }
        if ((mode === 'ki-to-o' && !reading.startsWith('キ')) ||
            (mode === 'o-to-ki' && !reading.startsWith('オ'))) {
            return;
        }
        const romanizedReading = japanese_1.default.romanize(reading, {
            うう: 'uu',
            おお: 'oo',
            おう: 'ou',
            んあ: 'na',
            あー: 'a-',
        });
        if ((mode === 'ki-to-o' && !romanizedReading.startsWith('ki')) ||
            (mode === 'o-to-ki' && !romanizedReading.startsWith('o'))) {
            return;
        }
        const replacedRomanization = mode === 'ki-to-o'
            ? romanizedReading.replace(/^ki/, 'o')
            : romanizedReading.replace(/^o/, 'ki');
        const isOk = replacedRomanization === normalizedReaction;
        if (!isOk) {
            return;
        }
        const achievedEmojis = (await (0, exports.get)(event.user, `reaction-${mode}-reactions-emojis`)) || [];
        if (!Array.isArray(achievedEmojis)) {
            log.error(`Invalid emojiTypes for ${event.user}: ${JSON.stringify(achievedEmojis)}`);
            return;
        }
        const newAchievedEmojis = (0, lodash_1.uniq)([...achievedEmojis, event.reaction]);
        await (0, exports.increment)(event.user, `reaction-${mode}-reactions`);
        await (0, exports.set)(event.user, `reaction-${mode}-reactions-emojis`, newAchievedEmojis);
        await (0, exports.set)(event.user, `reaction-${mode}-reactions-emoji-types`, newAchievedEmojis.length);
        if (reactedUsers.length >= 1) {
            const firstReactedUser = reactedUsers[0];
            if (firstReactedUser === event.user) {
                await (0, exports.increment)(event.user, `reaction-${mode}-reactions-first`, 1);
            }
        }
    });
};
exports.default = async ({ eventClient, webClient: slack, messageClient: slackInteractions }) => {
    loadDeferred.resolve(slack);
    eventClient.on('message', async (message) => {
        if ('text' in message &&
            message.text &&
            'user' in message &&
            message.user &&
            (!('bot_id' in message) || !message.bot_id) &&
            !message.subtype &&
            message.channel.startsWith('C')) {
            const day = (0, moment_1.default)(parseFloat(message.ts) * 1000).utcOffset(9).format('YYYY-MM-DD');
            (0, exports.increment)(message.user, 'chats');
            const lastChatDay = await (0, exports.get)(message.user, 'lastChatDay');
            if (lastChatDay !== day) {
                (0, exports.increment)(message.user, 'chatDays');
                (0, exports.set)(message.user, 'lastChatDay', day);
            }
        }
        if (message.channel.startsWith('D') && 'text' in message && message.text === '実績解除') {
            const manualAchievements = Array.from(achievements_1.default.values()).filter((achievement) => (achievement.manual === true &&
                state.achievements.has(message.user) &&
                Array.from(state.achievements.get(message.user)).every((id) => id !== achievement.id)));
            await slack.chat.postMessage({
                channel: message.channel,
                text: '未解除の実績一覧',
                attachments: manualAchievements.map((achievement) => ({
                    text: achievement.condition,
                    fallback: achievement.condition,
                    color: 'good',
                })),
            });
            await slack.chat.postMessage({
                channel: message.channel,
                text: '',
                attachments: (0, lodash_1.chunk)(manualAchievements, 5).map((achievementChunk, index) => ({
                    text: index === 0 ? '解除した実績を選んでね！' : '',
                    fallback: index === 0 ? '解除した実績を選んでね！' : '',
                    callback_id: 'achievements',
                    actions: achievementChunk.map((achievement) => ({
                        name: 'unlock',
                        text: achievement.condition,
                        type: 'button',
                        value: achievement.id,
                    })),
                })),
            });
        }
    });
    eventClient.on('reaction_added', async (event) => {
        await unlockReactionCountAchievements(event);
        await unlockKiToOAchievements(event);
    });
    slackInteractions.action({ type: 'button', callbackId: 'achievements' }, (payload, respond) => {
        (0, exports.unlock)(payload.user.id, payload.actions[0].value);
        respond({ text: 'おめでとう!:tada:' });
    });
    const achievementsData = await firestore_1.db.collection('achievements').get();
    if (!achievementsData.empty) {
        for (const doc of achievementsData.docs) {
            const { name, user } = doc.data();
            if (!state.achievements.has(user)) {
                state.achievements.set(user, new Set());
            }
            state.achievements.get(user).add(name);
        }
    }
    const usersData = await firestore_1.db.collection('users').get();
    const usersSet = new Set();
    if (!usersData.empty) {
        for (const doc of usersData.docs) {
            const data = doc.data();
            state.users.set(doc.id, data || Object.create(null));
            usersSet.add(doc.id);
        }
    }
    for (const [userId, userData] of state.users.entries()) {
        const userAchievements = state.achievements.get(userId) ?? new Set();
        for (const achievement of achievements_1.default.values()) {
            if (achievement.counter &&
                typeof achievement.value === 'number' &&
                !userAchievements.has(achievement.id)) {
                const counterValue = userData[achievement.counter];
                if (typeof counterValue === 'number' && counterValue >= achievement.value) {
                    (0, exports.unlock)(userId, achievement.id);
                }
            }
        }
    }
    initializeDeferred.resolve();
    const AchievementData = firestore_1.db.collection('achievement_data');
    const achievementsDataData = await AchievementData.get();
    const achievementsDataSet = new Set(achievementsDataData.docs.map((a) => a.id));
    for (const achievementChunks of (0, lodash_1.chunk)(Array.from(achievements_1.default), 300)) {
        const batch = firestore_1.db.batch();
        for (const [id, achievement] of achievementChunks) {
            const docRef = AchievementData.doc(id);
            if (achievementsDataSet.has(id)) {
                batch.update(docRef, {
                    difficulty: achievement.difficulty,
                    title: achievement.title,
                    condition: achievement.condition,
                    category: achievement.category,
                    ...(achievement.counter !== undefined && { counter: achievement.counter }),
                    ...(achievement.value !== undefined && { value: achievement.value }),
                    ...(achievement.manual !== undefined && { manual: achievement.manual }),
                });
            }
            else {
                batch.set(docRef, achievement);
            }
        }
        await batch.commit();
    }
};
const pendingOperations = [];
const updateDb = (operation) => {
    pendingOperations.push(operation);
    triggerUpdateDb();
};
// TODO: Sync back changes to local state
const triggerUpdateDb = (0, lodash_1.throttle)(async () => {
    const operations = pendingOperations.splice(0);
    const users = (0, lodash_1.groupBy)(operations, (operation) => operation.user);
    await firestore_1.db.runTransaction(async (transaction) => {
        const userData = new Map();
        // read before write
        await Promise.all(Object.keys(users).map(async (user) => {
            const userRef = firestore_1.db.collection('users').doc(user);
            const userTransaction = await transaction.get(userRef);
            (0, state_1.updateUsageCount)(`achievements_${user}_get`);
            const data = userTransaction.data() || {};
            userData.set(user, { data, exists: userTransaction.exists });
        }));
        for (const [user, userOperations] of Object.entries(users)) {
            const userRef = firestore_1.db.collection('users').doc(user);
            const { data, exists } = userData.get(user);
            for (const operation of userOperations) {
                if (operation.type === 'increment') {
                    if ({}.hasOwnProperty.call(data, operation.name)) {
                        data[operation.name] += operation.value;
                    }
                    else {
                        data[operation.name] = operation.value;
                    }
                }
                if (operation.type === 'set') {
                    data[operation.name] = operation.value;
                }
            }
            if (exists) {
                transaction.update(userRef, data);
                (0, state_1.updateUsageCount)(`achievements_${user}_update`);
            }
            else {
                transaction.set(userRef, data);
                (0, state_1.updateUsageCount)(`achievements_${user}_set`);
            }
        }
    });
}, 30 * 1000);
const getAchievementsText = (holdingAchievements, newDifficulty) => {
    const achievementCounts = (0, lodash_1.countBy)(holdingAchievements, (id) => achievements_1.default.get(id).difficulty);
    const hearts = [
        ['professional', ':purple_heart:'],
        ['hard', ':heart:'],
        ['medium', ':orange_heart:'],
        ['easy', ':green_heart:'],
        ['baby', ':blue_heart:'],
    ].map(([difficulty, emoji]) => {
        const count = (0, lodash_1.get)(achievementCounts, [difficulty], 0);
        if (difficulty === newDifficulty) {
            return `${emoji}*${count}*`;
        }
        return `${emoji}${count}`;
    });
    return [
        ...hearts,
        `計 *${holdingAchievements.length}* 個`,
    ].join(' ');
};
const unlock = async (user, name, additionalInfo) => {
    await initializeDeferred.promise;
    const achievement = achievements_1.default.get(name);
    if (!achievement) {
        throw new Error(`Unknown achievement name ${name}`);
    }
    if (!user || !user.startsWith('U') || user === 'USLACKBOT') {
        return;
    }
    if (!state.achievements.has(user)) {
        state.achievements.set(user, new Set());
    }
    if (state.achievements.get(user).has(name)) {
        return;
    }
    const existingAchievements = await firestore_1.db.collection('achievements').where('name', '==', name).get();
    const isFirst = existingAchievements.empty;
    const slack = await loadDeferred.promise;
    state.achievements.get(user).add(name);
    await firestore_1.db.collection('achievements').add({
        user,
        name,
        date: new Date(),
    });
    const holdingAchievements = Array.from(state.achievements.get(user));
    const userUrl = `https://achievements.tsg.ne.jp/users/${user}`;
    const achievementUrl = `https://achievements.tsg.ne.jp/achievements/${achievement.id}`;
    slack.chat.postMessage({
        channel: process.env.CHANNEL_SANDBOX,
        username: 'achievements',
        icon_emoji: ':unlock:',
        text: (0, common_tags_1.stripIndent) `
			<@${user}>が実績【<${achievementUrl}|${achievement.title}>】を解除しました:tada::tada::tada: <${userUrl}|[実績一覧]>
			_${achievement.condition}_
			難易度${difficultyToStars(achievement.difficulty)} (${achievement.difficulty}) ${isFirst ? '*初達成者!!:ojigineko-superfast:*' : ''}
			${additionalInfo === undefined ? '' : additionalInfo}`,
        attachments: [{
                text: getAchievementsText(holdingAchievements, achievement.difficulty),
            }],
    });
    const newAchievements = [];
    if (holdingAchievements.length >= 1) {
        newAchievements.push('achievements');
    }
    if (holdingAchievements.filter((id) => achievements_1.default.get(id).difficulty !== 'baby').length >= 3) {
        newAchievements.push('achievements-3');
    }
    if (holdingAchievements.filter((id) => achievements_1.default.get(id).difficulty !== 'baby').length >= 10) {
        newAchievements.push('achievements-10');
    }
    if (holdingAchievements.filter((id) => achievements_1.default.get(id).difficulty !== 'baby').length >= 70) {
        newAchievements.push('achievements-70');
    }
    if (holdingAchievements.filter((id) => (achievements_1.default.get(id).difficulty !== 'baby' &&
        achievements_1.default.get(id).difficulty !== 'easy')).length >= 10) {
        newAchievements.push('achievements-master');
    }
    for (const newAchievement of newAchievements) {
        await (0, exports.unlock)(user, newAchievement);
    }
};
exports.unlock = unlock;
// migration purpose only. not modifying local state
const lock = async (user, name) => {
    const achievement = achievements_1.default.get(name);
    if (!achievement) {
        throw new Error(`Unknown achievement name ${name}`);
    }
    if (!user || !user.startsWith('U') || user === 'USLACKBOT') {
        throw new Error(`Invalid user name ${user}`);
    }
    const existingAchievement = await firestore_1.db.collection('achievements').where('name', '==', name).where('user', '==', user).get();
    if (existingAchievement.empty) {
        log.error(`${user} is not unlocking ${name} on db`);
    }
    else {
        for (const doc of existingAchievement.docs) {
            await doc.ref.delete();
        }
    }
    log.debug(`@${user}の実績「${achievement.title}」を削除しました`);
};
exports.lock = lock;
const isUnlocked = async (user, name) => {
    await initializeDeferred.promise;
    const achievement = achievements_1.default.get(name);
    if (!achievement) {
        throw new Error(`Unknown achievement name ${name}`);
    }
    if (!user || !user.startsWith('U') || user === 'USLACKBOT') {
        return false;
    }
    if (!state.achievements.has(user)) {
        state.achievements.set(user, new Set());
    }
    return state.achievements.get(user).has(name);
};
exports.isUnlocked = isUnlocked;
const increment = async (user, name, value = 1, additionalInfo = undefined) => {
    await initializeDeferred.promise;
    if (!user || !user.startsWith('U') || user === 'USLACKBOT') {
        return;
    }
    if (!state.users.has(user)) {
        state.users.set(user, Object.create(null));
    }
    const oldValue = state.users.get(user)[name] ?? 0;
    if (typeof oldValue !== 'number') {
        log.error(`Invalid value for ${user} on ${name}: ${oldValue}`);
        return;
    }
    const newValue = oldValue + value;
    state.users.get(user)[name] = newValue;
    const unlocked = Array.from(achievements_1.default.values()).filter((achievement) => achievement.counter === name && achievement.value <= newValue);
    for (const achievement of unlocked) {
        (0, exports.unlock)(user, achievement.id, additionalInfo);
    }
    updateDb({ type: 'increment', name, value, user });
};
exports.increment = increment;
const get = async (user, name) => {
    await initializeDeferred.promise;
    if (!user || !user.startsWith('U') || user === 'USLACKBOT') {
        return undefined;
    }
    if (!state.users.has(user)) {
        state.users.set(user, Object.create(null));
    }
    return state.users.get(user)[name];
};
exports.get = get;
const set = async (user, name, value) => {
    await initializeDeferred.promise;
    if (!user || !user.startsWith('U') || user === 'USLACKBOT') {
        return;
    }
    if (!state.users.has(user)) {
        state.users.set(user, Object.create(null));
    }
    state.users.get(user)[name] = value;
    if (typeof value === 'number') {
        const unlocked = Array.from(achievements_1.default.values()).filter((achievement) => achievement.counter === name && achievement.value <= value);
        for (const achievement of unlocked) {
            (0, exports.unlock)(user, achievement.id);
        }
    }
    updateDb({ type: 'set', user, name, value });
};
exports.set = set;
