"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const custom_responses_1 = __importDefault(require("./custom-responses"));
const lodash_1 = require("lodash");
const achievements_1 = require("../achievements");
const state_1 = require("../lib/state");
const unicode_scripts_1 = __importDefault(require("../lib/unicode-scripts"));
const getScript = (char) => {
    for (const [script, regex] of Object.entries(unicode_scripts_1.default)) {
        if (regex.test(char))
            return script;
    }
    return 'Unknown';
};
const splitTextToChunks = (text) => {
    const chars = Array.from(text);
    if (chars.length === 0) {
        return [];
    }
    const chunks = [chars[0]];
    let lastScript = getScript(chars[0]);
    for (const char of chars.slice(1)) {
        const script = getScript(char);
        if (script !== lastScript) {
            chunks.push(char);
        }
        else {
            chunks[chunks.length - 1] += char;
        }
        lastScript = script;
    }
    return chunks;
};
// Implement KMP algorithm
const matchByChunks = (haystack, needle) => {
    const m = haystack.length;
    const n = needle.length;
    let i, j;
    j = 0;
    const table = haystack.map((chunk, index) => {
        if (index === 0) {
            return 0;
        }
        if (chunk === haystack[j]) {
            j += 1;
            return j;
        }
        let oldJ = j;
        j = 0;
        return oldJ;
    });
    for (i = 0, j = 0; i < m && j < n;) {
        if (haystack[i] === needle[j]) {
            i += 1;
            j += 1;
        }
        else if (j === 0) {
            i += 1;
        }
        else {
            j = table[j];
        }
    }
    return j === n;
};
const response = async (text, context, textResponses) => {
    for (const resp of custom_responses_1.default.filter((response) => !response.reaction)) {
        for (const regexp of resp.input) {
            const matches = text.match(regexp);
            if (matches !== null) {
                const responses = Array.isArray(resp.outputArray)
                    ? resp.outputArray
                    : await resp.outputFunction(matches, context);
                if (!responses)
                    continue;
                const respText = resp.shuffle ? (0, lodash_1.shuffle)(responses).join('') : (0, lodash_1.sample)(responses);
                const respAchievements = [];
                if (resp.achievements) {
                    for (const achieve of resp.achievements) {
                        for (const trigger of achieve.trigger) {
                            const achieveMatches = respText.match(trigger);
                            if (achieveMatches !== null) {
                                respAchievements.push(achieve.name);
                            }
                        }
                    }
                }
                return {
                    text: respText,
                    username: resp.username,
                    icon_emoji: resp.icon_emoji,
                    achievements: respAchievements,
                };
            }
        }
    }
    const chunks = splitTextToChunks(text);
    for (const response of textResponses) {
        for (const input of response.input) {
            let matched = false;
            if (response.chunk_match === true) {
                const inputChunks = splitTextToChunks(input);
                matched = matchByChunks(chunks, inputChunks);
            }
            else {
                matched = text.includes(input);
            }
            if (matched) {
                const respText = (0, lodash_1.sample)(response.output);
                return {
                    text: respText,
                    username: response.username,
                    icon_emoji: response.icon_emoji,
                    achievements: [],
                };
            }
        }
    }
    return null;
};
const reaction = async (text, context) => {
    for (const resp of custom_responses_1.default.filter((response) => response.reaction)) {
        for (const regexp of resp.input) {
            const matches = text.match(regexp);
            if (matches !== null) {
                const responses = {}.hasOwnProperty.call(resp, 'outputArray') ? resp.outputArray : await resp.outputFunction(matches, context);
                if (!responses)
                    continue;
                return resp.shuffle ? (0, lodash_1.shuffle)(responses) : [(0, lodash_1.sample)(responses)];
            }
        }
    }
    return null;
};
exports.default = async ({ eventClient, webClient: slack }) => {
    const state = await state_1.ReadOnlyState.init('better-custom-response', {
        textResponses: [],
    });
    eventClient.on('message', async (message) => {
        if (!message.user || message.user.startsWith('B') || message.user === 'UEJTPN6R5' || message.user === 'USLACKBOT')
            return;
        const { channel, text, ts: timestamp, user, thread_ts, subtype } = message;
        if (!text)
            return;
        const context = { user };
        const resp = await response(text, context, state.textResponses);
        if (resp) {
            const username = !resp.username ? 'better-custom-response' : resp.username;
            const icon_emoji = !resp.icon_emoji ? ':slack:' : resp.icon_emoji;
            await slack.chat.postMessage({
                channel: message.channel,
                text: resp.text,
                username,
                icon_emoji,
                thread_ts,
                reply_broadcast: subtype === 'thread_broadcast',
            });
            for (const achievementID of resp.achievements) {
                await (0, achievements_1.unlock)(message.user, achievementID);
            }
        }
        const reac = await reaction(text, context);
        if (!reac)
            return;
        for (const reaction of reac) {
            try {
                await slack.reactions.add({ name: reaction, channel, timestamp });
            }
            catch (e) {
                if (e.data.error !== "already_reacted")
                    throw e;
            }
        }
    });
};
