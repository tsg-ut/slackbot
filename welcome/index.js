"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const axios_1 = __importDefault(require("axios"));
const logger_1 = __importDefault(require("../lib/logger"));
const log = logger_1.default.child({ bot: 'welcome' });
// https://scrapbox.io/help-jp/API
// https://scrapbox.io/scrapboxlab/%E3%82%B3%E3%83%BC%E3%83%89%E3%83%96%E3%83%AD%E3%83%83%E3%82%AF
const welcomeScrapboxUrl = `https://scrapbox.io/api/code/tsg/welcome/message`;
async function extractWelcomeMessage() {
    const { data } = await axios_1.default.get(welcomeScrapboxUrl, {
        headers: {
            Cookie: `connect.sid=${process.env.SCRAPBOX_SID}`,
        },
    });
    return data;
}
exports.default = async ({ eventClient, webClient: slack }) => {
    const postWelcomeMessage = async (slack, channel, text) => {
        return slack.chat.postMessage({
            channel,
            text,
            link_names: true,
            icon_emoji: ':tsg:',
            username: 'TSG',
            unfurl_links: false,
            unfurl_media: false,
        });
    };
    eventClient.on('team_join', async ({ user }) => {
        const userid = user.id;
        if (!userid) {
            return;
        }
        try {
            const message = await extractWelcomeMessage();
            await postWelcomeMessage(slack, userid, message);
            await slack.chat.postMessage({
                channel: process.env.CHANNEL_SANDBOX,
                text: `Welcome <@${userid}> to TSG! :tada:`,
                icon_emoji: ':tsg:',
                username: 'welcome',
            });
        }
        catch (e) {
            log.error('welcome error > ', e);
            await slack.chat.postMessage({
                channel: process.env.CHANNEL_SANDBOX,
                text: `welcome for <@${userid}> error :cry:`,
                icon_emoji: ':exclamation:',
                username: 'welcome',
            });
        }
    });
    eventClient.on('message', async ({ channel, text }) => {
        // preview mode
        if (!channel || !text) {
            return;
        }
        if (channel.startsWith('D') && text.trim() === 'welcome') {
            const message = await extractWelcomeMessage();
            await postWelcomeMessage(slack, channel, message);
        }
    });
};
