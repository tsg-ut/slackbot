import type {SlackInterface} from '../lib/slack';
import logger from '../lib/logger';
import {stripIndents} from 'common-tags';
import axios from 'axios';
import { shuffle } from 'lodash';
import { ChatPostMessageArguments, WebAPICallOptions } from '@slack/web-api';

const BOT_NAME = "Wordle Battle (beta)";
const TL_SECONDS = 90;

interface Player {
    user: string,
    answer: string,
    queries: string[],
};

class State {
    thread_ts: string;
    status: "Idle" | "Waiting" | "Gaming";
    length: number;
    players: Player[];
    next: 0 | 1; // player to answer next
    timeoutID: NodeJS.Timeout;
    constructor() {
        this.init();
    }
    init() {
        this.thread_ts = null;
        this.status = "Idle";
        this.length = null;
        this.players = [];
        this.next = null;
        this.timeoutID = null;
    }
    startGame() {
        this.status = "Gaming";
        this.players = shuffle(this.players);
        this.next = 0;
    }
    addPlayer(user: string, answer: string) {
        this.players.push({
            user: user,
            answer: answer,
            queries: []
        });
    }
    // query を追加する (answer と一致する場合は true を返す)
    doTurn(query: string): boolean {
        this.players[1 - this.next].queries.push(query);
        this.next = this.next ? 0 : 1;
        return this.players[this.next].answer === query;
    }
    passTurn() {
        this.next = this.next ? 0 : 1;
    }
    clearTimer() {
        if (!!this.timeoutID) {
            clearTimeout(this.timeoutID);
        }
    }
    setTimer(func: () => void) {
        this.clearTimer();
        this.timeoutID = setTimeout(func, TL_SECONDS * 1000);
    }
};

export default async ({eventClient, webClient: slack}: SlackInterface) => {
    const state = new State();

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

    const constructMessage = (index: 0 | 1) => {
        const player = state.players[index];
        return player.queries.slice().reverse().map((query) => {
            const pattern = getWordlePattern(query, state.players[index].answer);
            const patternText = pattern.map((c) => c === 2 ? ":large_green_square:" : c === 1 ? ":large_yellow_square:" : ":white_large_square:").join("");
            return `\`${query}\` ${patternText}`;
        }).join("\n");
    };

    const postMessage = async (messageText: string, option: WebAPICallOptions) => {
        const args = Object.assign({}, {
            channel: process.env.CHANNEL_SANDBOX,
            text: messageText,
            username: BOT_NAME,
            icon_emoji: ":capital_abcd:",
        }, option);
        return slack.chat.postMessage(args as ChatPostMessageArguments);
    }

    const postReply = async (messageText: string) => {
        return postMessage(messageText, {thread_ts: state.thread_ts});
    };

    const postReplyBroadcast = async (messageText: string) => {
        return postMessage(messageText, {thread_ts: state.thread_ts, reply_broadcast: true});
    };

    const postAnnounce = async (messageText: string) => {
        return postMessage(messageText, {});
    };

    const setStateTimer = () => {
        // state.setTimer(async () => {
        //     await postReply(stripIndents`:clock3: タイムオーバー :sweat:
        //     勝者：<@${state.players[state.next ? 0 : 1].user}>
        //     <@${state.players[state.next ? 1 : 0].user}> さんの単語は ${state.players[state.next ? 1 : 0].answer}、
        //     <@${state.players[state.next ? 0 : 1].user}> さんの単語は ${state.players[state.next ? 0 : 1].answer} でした。`);
        //     state.init();
        // });
        state.setTimer(async () => {
            state.passTurn();
            await postReply(stripIndents`:clock3: タイムオーバー :sweat:
            次は <@${state.players[state.next].user}> さんの番です。${TL_SECONDS} 秒以内に答えてください。`);
        });
    };

    eventClient.on("message", async (message: any) => {
        if (!message.text || message.subtype !== undefined) {
            return;
        }
        const {channel, text, ts, thread_ts} = message;
        if (channel === process.env.CHANNEL_SANDBOX) {
            if (text === "wordle reset") {
                state.init();
                await postAnnounce("Wordle Battle をリセットしました。");
            }
            else if (text.match(/^wordle battle( \d*)?$/)) {
                if (state.status === "Idle") {
                    // ゲーム開始
                    const lengthArr = /^wordle battle (\d*)$/.exec(text);
                    const lengthStr = lengthArr && (lengthArr.length < 2 ? null : lengthArr[1]);
                    const length = lengthStr ? parseInt(lengthStr) : 6;
                    state.length = length;
                    if (length < 2 || length > 15) {
                        await postAnnounce("Wordle Battle は 2 文字以上 15 文字以下の単語のみに対応しています。");
                    }
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
                                state.clearTimer();
                                const isWin = state.doTurn(text);
                                await postReply(stripIndents`受理された単語： \`${text}\`
                                ${constructMessage(state.next)}`
                                + '\n' + (isWin ? `正解です！！ :tada:` : `次は <@${state.players[state.next].user}> さんの番です。${TL_SECONDS} 秒以内に答えてください。`));
                                if (isWin) {
                                    await postReplyBroadcast(stripIndents`勝者：<@${state.players[state.next ? 0 : 1].user}>
                                    ${constructMessage(state.next)}
                                    <@${state.players[state.next ? 0 : 1].user}> さんの単語は ${state.players[state.next ? 0 : 1].answer} でした。`);
                                    state.init();
                                }
                                else {
                                    setStateTimer();
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
                                state.addPlayer(message.user, tokens[1]);
                                await slack.reactions.add({
                                    name: "+1",
                                    channel: channel,
                                    timestamp: ts
                                });
                                await postReplyBroadcast(stripIndents`<@${message.user}> さんが単語を登録したよ！
                                残り人数: ${2 - state.players.length} 人`);
                                if (state.players.length === 2) {
                                    state.status = "Gaming";
                                    state.startGame();
                                    await postReply(stripIndents`ゲーム開始！ 先手：<@${state.players[0].user}> 後手：<@${state.players[1].user}>
                                    <@${state.players[0].user}> さんは ${TL_SECONDS} 秒以内に ${state.length} 文字の英単語をリプライしてください`);
                                    setStateTimer();
                                }
                            }
                        }
                        else {
                            postDM(`その単語は辞書に登録されていません :sob:`);
                        }
                    }
                    else {
                        postDM(`Wordle Battle へ登録する単語は英小文字で構成された長さ *${state.length}* の単語にしてください！`);
                    }
                }
            }
        }
    });
}