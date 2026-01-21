"use strict";
// Based on https://github.com/ut-ap2021/ap2021bot/blob/main/src/adventar/index.ts
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const common_tags_1 = require("common-tags");
const jsdom_1 = require("jsdom");
const assert_1 = __importDefault(require("assert"));
const util_1 = require("util");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const async_mutex_1 = require("async-mutex");
const fetchAdventarSnapshot = async (pageID) => {
    const url = `https://adventar.org/calendars/${pageID}`;
    const document = (await jsdom_1.JSDOM.fromURL(url)).window.document;
    const title = document.getElementsByClassName('title')[0].innerHTML;
    const year = (() => {
        const matchedYear = title.match(/(\d+)$/);
        (0, assert_1.default)(matchedYear);
        return parseInt(matchedYear[1]);
    })();
    const entryList = Array(26).fill(null);
    Array.from(document.getElementsByClassName('EntryList')[0].children).forEach(entry => {
        const elemHead = entry.getElementsByClassName('head')[0];
        const elemArticle = entry.getElementsByClassName('article')[0];
        const date = parseInt(elemHead.getElementsByClassName('date')[0].innerHTML.substr(3), 10);
        const user = {
            uid: parseInt(elemHead
                .getElementsByTagName('a')[0]
                .getAttribute('href').substr(7)),
            name: elemHead.getElementsByTagName('a')[0].innerHTML,
            iconURI: elemHead
                .getElementsByTagName('img')[0]
                .getAttribute('src'),
        };
        const articleURI = elemArticle
            ? elemArticle.getElementsByTagName('a')[0].getAttribute('href')
            : null;
        entryList[date] = { user, articleURI };
    });
    return {
        title,
        year,
        pageID,
        entryList,
    };
};
const snapshotsPath = path_1.default.join(__dirname, 'snapshots.json');
const loadAdventarSnapshots = async () => {
    const snapshots = (await (0, util_1.promisify)(fs_1.default.exists)(snapshotsPath))
        ? JSON.parse(await (0, util_1.promisify)(fs_1.default.readFile)(snapshotsPath, {
            encoding: 'utf8',
        }))
        : [];
    return snapshots;
};
const saveAdventarSnapshots = async (snapshots) => {
    await (0, util_1.promisify)(fs_1.default.writeFile)(snapshotsPath, JSON.stringify(snapshots));
    return;
};
exports.default = async ({ eventClient, webClient: slack, }) => {
    const mutex = new async_mutex_1.Mutex();
    const postMessage = async (text, unfurl_links = false) => {
        await slack.chat.postMessage({
            text,
            channel: process.env.CHANNEL_SANDBOX,
            username: 'Advent Calendar',
            icon_emoji: 'calendar',
            unfurl_links,
        });
    };
    const snapshots = await loadAdventarSnapshots();
    const setEntryListAndSave = async (index, newEntryList) => {
        mutex.runExclusive(async () => {
            snapshots[index].entryList = JSON.parse(JSON.stringify(newEntryList));
            await saveAdventarSnapshots(snapshots);
        });
    };
    const addCalendarAndSave = async (snapshot) => {
        mutex.runExclusive(async () => {
            snapshots.push(JSON.parse(JSON.stringify(snapshot)));
            await saveAdventarSnapshots(snapshots);
        });
    };
    const notifyAdventarCalendarsUpdate = async () => {
        if (snapshots.length <= 0)
            return;
        snapshots.forEach(async (ss, index) => {
            const ssNew = await fetchAdventarSnapshot(ss.pageID);
            (0, assert_1.default)(ssNew);
            for (let i = 1; i <= 25; i++) {
                if (!ss.entryList[i] && ssNew.entryList[i]) {
                    postMessage(`『<https://adventar.org/calendars/${ss.pageID}|*${ss.title}*>』の${i}日目に *${ssNew.entryList[i]?.user.name}* さんが登録したよ :pro::tensai::100::yatta-:`);
                }
                if (ss.entryList[i] && !ssNew.entryList[i]) {
                    postMessage(`『<https://adventar.org/calendars/${ss.pageID}|*${ss.title}*>』の${i}日目の登録がキャンセルされたよ :cry:`);
                }
                if ((!ss.entryList[i] || !ss.entryList[i]?.articleURI) &&
                    ssNew.entryList[i] &&
                    ssNew.entryList[i]?.articleURI) {
                    postMessage((0, common_tags_1.stripIndent) `
            『<https://adventar.org/calendars/${ss.pageID}|*${ss.title}*>』の${i}日目の *${ssNew.entryList[i]?.user.name}* さんの記事が公開されたよ :tada::iihanashi::essential-information:
            <${ssNew.entryList[i]?.articleURI}>`, true);
                }
                if (ss.entryList[i] &&
                    ss.entryList[i]?.articleURI &&
                    (!ssNew.entryList[i] || !ssNew.entryList[i]?.articleURI)) {
                    postMessage((0, common_tags_1.stripIndent) `
            『<https://adventar.org/calendars/${ss.pageID}|*${ss.title}*>』の${i}日目の記事の公開が取り下げられたよ :cry:`);
                }
            }
            setEntryListAndSave(index, ssNew.entryList);
        });
    };
    setInterval(notifyAdventarCalendarsUpdate, 60 * 1000);
    eventClient.on('message', async (message) => {
        if (message.channel !== process.env.CHANNEL_SANDBOX) {
            return;
        }
        if (message.subtype === 'bot_message' ||
            message.subtype === 'slackbot_response') {
            return;
        }
        if (!message.text) {
            return;
        }
        // アドカレ登録
        if (message.text.match(/^@advent\sregister\s<https:\/\/adventar\.org\/calendars\/(\d+)(\|.*)?>$/)) {
            const pageID = parseInt(message.text.match(/^@advent\sregister\s<https:\/\/adventar\.org\/calendars\/(\d+)(\|.*)?>$/)[1]);
            if (snapshots.some(ss => ss.pageID === pageID)) {
                postMessage('そのアドベントカレンダーはすでに登録されているよ :yosasou:');
                return;
            }
            else {
                try {
                    const ss = await fetchAdventarSnapshot(pageID);
                    const date = new Date();
                    date.setHours(date.getUTCHours() + 9);
                    if (ss.year < date.getFullYear()) {
                        postMessage('終了したアドベントカレンダーは登録できないよ :cry:');
                        return;
                    }
                    else {
                        addCalendarAndSave(ss);
                        postMessage(`『<https://adventar.org/calendars/${ss.pageID}|*${ss.title}*>』を登録したよ :waiwai:`, true);
                    }
                }
                catch (e) {
                    postMessage((0, common_tags_1.stripIndent) `
              :cry:読み込みエラー
              <https://adventar.org/calendars/${pageID}|https://adventar.org/calendars/${pageID}> は存在しない可能性があります`);
                    return;
                }
            }
        }
        // アドカレ一覧
        if (message.text.match(/^@advent list$/)) {
            let adventsStr = '登録されたアドカレ：\n';
            if (snapshots) {
                snapshots.forEach((ss) => {
                    adventsStr += `- 『<https://adventar.org/calendars/${ss.pageID}|*${ss.title}*>』\n`;
                });
            }
            else {
                adventsStr += '該当なし\n';
            }
            postMessage(adventsStr);
        }
    });
};
