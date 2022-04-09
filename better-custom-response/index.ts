import customResponses from './custom-responses';
import type {Context} from './custom-responses';
import {sample, shuffle} from 'lodash';
import type {SlackInterface} from '../lib/slack';
import {unlock} from '../achievements';
import {ReadOnlyState} from "../lib/state";
import unicodeScripts from "../lib/unicode-scripts";

interface TextResponse {
    readonly input: ReadonlyArray<string>,
    readonly output: ReadonlyArray<string>,
    readonly username?: string,
    readonly icon_emoji?: string,
    readonly chunk_match?: boolean,
}

interface StateObj {
    readonly textResponses: ReadonlyArray<TextResponse>,
}

const getScript = (char: string) => {
    for (const [script, regex] of Object.entries(unicodeScripts)) {
        if (regex.test(char)) return script;
    }
    return 'Unknown';
};

const splitTextToChunks = (text: string) => {
    const chars = Array.from(text);
    if (chars.length === 0) {
        return [];
    }

    const chunks: string[] = [chars[0]];
    let lastScript = getScript(chars[0]);
    for (const char of chars.slice(1)) {
        const script = getScript(char);
        if (script !== lastScript) {
            chunks.push(char);
        } else {
            chunks[chunks.length - 1] += char;
        }
        lastScript = script;
    }

    return chunks;
};

// Implement KMP algorithm
const matchByChunks = (haystack: string[], needle: string[]) => {
    const m = haystack.length;
    const n = needle.length;
    let i: number, j: number;
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
        } else if (j === 0) {
            i += 1;
        } else {
            j = table[j];
        }
    }
    return j === n;
};

const response = async (text: string, context: Context, textResponses: ReadonlyArray<TextResponse>) => {
    for (const resp of customResponses.filter((response) => !response.reaction)) {
        for (const regexp of resp.input) {
            const matches = text.match(regexp);
            if (matches !== null) {
                const responses = Array.isArray(resp.outputArray)
                    ? resp.outputArray
                    : await resp.outputFunction(matches, context);
                if (!responses) continue;
                const respText = resp.shuffle ? shuffle(responses).join('') : sample(responses);
                const respAchievements: string[] = [];
                if (resp.achievements) {
                    for (const achieve of resp.achievements) {
                        for (const trigger of achieve.trigger){
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
            } else {
                matched = text.includes(input);
            }

            if (matched) {
                const respText = sample(response.output);
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

const reaction = async (text: string, context: Context) => {
    for (const resp of customResponses.filter((response) => response.reaction)) {
        for (const regexp of resp.input) {
            const matches = text.match(regexp);
            if (matches !== null) {
                const responses = {}.hasOwnProperty.call(resp, 'outputArray') ? resp.outputArray : await resp.outputFunction(matches, context);
                if (!responses) continue;
                return resp.shuffle ? shuffle(responses) : [sample(responses)];
            }
        }
    }
    return null;
};

export default async ({eventClient, webClient: slack}: SlackInterface) => {
    const state = await ReadOnlyState.init<StateObj>('better-custom-response', {
        textResponses: [],
    });

    eventClient.on('message', async (message) => {
        if (!message.user || message.user.startsWith('B') || message.user === 'UEJTPN6R5' || message.user === 'USLACKBOT') return;
        const {channel, text, ts: timestamp, user, thread_ts, subtype} = message;
        if (!text) return;
        const context: Context = {user};
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
                await unlock(message.user, achievementID);
            }
        }
        const reac = await reaction(text, context);
        if (!reac) return;
        for (const reaction of reac) {
            try {
                await slack.reactions.add({name: reaction, channel, timestamp});
            } catch (e) {
                if (e.data.error !== "already_reacted") throw e;
            }
        }
    });
}
