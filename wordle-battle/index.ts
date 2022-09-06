import type {SlackInterface} from '../lib/slack';
import logger from '../lib/logger';
import {stripIndents} from 'common-tags';
import axios from 'axios';
import { shuffle } from 'lodash';

const BOT_NAME = "Wordle Battle (beta)";

interface Player {
    user: string,
    answer: string,
    queries: string[],
};

interface State {
    thread_ts: string,
    status: "Idle" | "Waiting" | "Gaming",
    length: number,
    players: Player[],
    next: 0 | 1, // player to answer next
};

export default async ({eventClient, webClient: slack}: SlackInterface) => {
    const state: State = {
        thread_ts: null,
        status: "Idle",
        length: null,
        players: [],
        next: null,
    };
    
    const initState = () => {
        state.thread_ts = null;
        state.status = "Idle";
        state.length = null;
        state.players = [];
        state.next = null;
    };

    const wordExists = async (word: string): Promise<boolean> => {
        const apiLink = `https://api.dictionaryapi.dev/api/v2/entries/en/${word}`;
        logger.info("Getting from " + apiLink);
        try {
            const response = await axios.get(apiLink);
            return !!response.data[0];
        }
        catch (error) {
            logger.info(error);
            return false;
        }
    };

    // word と answer から 0 = miss, 1 = blow, 2 = hit の配列を返す
    const getWordlePattern = (word: string, answer: string): (0 | 1 | 2)[] => {
        return word.split('').map((c, i) => 
            answer[i] === c ? 2 : answer.includes(c) ? 1 : 0
        );
    }

    const addPlayer = (user: string, answer: string) => {
        state.players.push({
            user: user,
            answer: answer,
            queries: []
        });
    };

    const startGame = () => {
        state.status = "Gaming";
        state.players = shuffle(state.players);
        state.next = 0;
    };

    // query を追加する (answer と一致する場合は true を返す)
    const doTurn = (query: string): boolean => {
        state.players[1 - state.next].queries.push(query);
        state.next = state.next ? 0 : 1;
        return state.players[state.next].answer === query;
    };

    const constructMessage = (index: 0 | 1) => {
        const player = state.players[index];
        return player.queries.reverse().map((query) => {
            const pattern = getWordlePattern(query, state.players[index].answer);
            const patternText = pattern.map((c) => c === 2 ? ":large_green_square:" : c === 1 ? ":large_yellow_square:" : ":white_large_square:").join("");
            return `\`${query}\` ${patternText}`;
        }).join("\n");
    };

    const postReply = async (messageText: string) => {
        await slack.chat.postMessage({
            channel: process.env.CHANNEL_SANDBOX,
            text: messageText,
            thread_ts: state.thread_ts,
            username: BOT_NAME,
            icon_emoji: ":capital_abcd:"
        });
    };

    const postReplyBroadcast = async (messageText: string) => {
        await slack.chat.postMessage({
            channel: process.env.CHANNEL_SANDBOX,
            text: messageText,
            thread_ts: state.thread_ts,
            reply_broadcast: true,
            username: BOT_NAME,
            icon_emoji: ":capital_abcd:"
        });
    };

    const postAnnounce = async (messageText: string) => {
        await slack.chat.postMessage({
            channel: process.env.CHANNEL_SANDBOX,
            text: messageText,
            username: BOT_NAME,
            icon_emoji: ":capital_abcd:"
        });
    };

    eventClient.on("message", async (message: any) => {
        if (!message.text || message.subtype !== undefined) {
            return;
        }
        const {channel, text, ts, thread_ts} = message;
        if (message.channel === process.env.CHANNEL_SANDBOX) {
            logger.info(ts);
            if (text === "wordle reset") {
                initState();
                await postAnnounce("Wordle Battle をリセットしました。");
            }
            else if (text === "wordle battle") {
                if (state.status === "Idle") {
                    // ゲーム開始
                    const length = 6;
                    state.length = length;
                    state.thread_ts = ts;
                    await postReplyBroadcast(stripIndents`Wordle Battle を開始します！
                    参加希望者は ${length} 文字の英単語を <@${process.env.USER_TSGBOT}> へ DM で送信してください。
                    例： \`hoge\` を登録したい場合 \`wordle hoge\` と送信`);
                    state.status = "Waiting";
                }
                else if (state.status === "Waiting") {
                    await postAnnounce("Wordle Battle はすでにプレイヤーの募集中です。");
                }
                else if (state.status === "Gaming") {
                    await postAnnounce("Wordle Battle は進行中です。");
                }
            }
            else if (thread_ts === thread_ts) {
                if (state.status === "Gaming") {
                    if (state.players[state.next].user === message.user) {
                        if (/^[a-z]*$/.test(text) && text.length === state.length) {
                            if (await wordExists(text)) {
                                const isWin = doTurn(text);
                                await postReply(stripIndents`受理された単語： \`${text}\`
                                ${constructMessage(state.next)}`
                                + '\n' + (isWin ? `正解です！！ :tada:` : `次は <@${state.players[state.next].user}> さんの番です。`));
                                if (isWin) {
                                    await postReplyBroadcast(stripIndents`勝者：<@${state.players[state.next ? 0 : 1].user}>
                                    ${constructMessage(state.next)}
                                    <@${state.players[state.next ? 0 : 1].user}> さんの単語は ${state.players[state.next ? 0 : 1].answer} でした。`);
                                    initState();
                                }
                            }
                            else {
                                await slack.reactions.add({
                                    name: "thinking_face",
                                    channel: channel,
                                    timestamp: ts
                                });
                            }
                        }
                    }
                }
            }
        }

        if (message.channel.startsWith("D")) {
            const postDM = async (messageText: string) => {
                await slack.chat.postMessage({
                    channel: message.channel,
                    text: messageText,
                    username: "Wordle Battle",
                    icon_emoji: ":capital_abcd:"
                })
            };
            const tokens: string[] = text.trim().split(/\s+/);
            if (tokens[0].toLowerCase() === "wordle") {
                if (state.status === "Idle") {
                    postDM(`Wordle Battle は開始されていません。<#${process.env.CHANNEL_SANDBOX}> で開始を宣言してください。`);
                }
                else if (state.status === "Waiting") {
                    logger.info(`Word [${tokens[1]}] received`);
                    logger.info(`Length = [${tokens[1].length}]`);
                    if (tokens[1].length === state.length && /^[a-z]*$/.test(tokens[1])) {
                        const isValid = await wordExists(tokens[1]);
                        if (isValid) {
                            if (state.players.length < 2) {
                                addPlayer(message.user, tokens[1]);
                                await slack.reactions.add({
                                    name: "+1",
                                    channel: channel,
                                    timestamp: ts
                                });
                                await postReplyBroadcast(stripIndents`<@${message.user}> さんが単語を登録したよ！
                                残り人数: ${2 - state.players.length} 人`);
                                if (state.players.length === 2) {
                                    state.status = "Gaming";
                                    startGame();
                                    await postReply(stripIndents`ゲーム開始！ 先手：<@${state.players[0].user}> 後手：<@${state.players[1].user}>
                                    <@${state.players[0].user}> さんは ${state.length} 文字の英単語をリプライしてください`);
                                }
                            }
                        }
                        else {
                            postDM(`その単語は辞書に登録されていません :sob:`);
                        }
                    }
                    else {
                        postDM(`Wordle Battle へ登録する単語は英小文字で構成された長さ ${state.length} の単語にしてください！`);
                    }
                }
            }
        }
    });
}