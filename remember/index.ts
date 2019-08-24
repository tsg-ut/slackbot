import * as fs from 'fs';
// @ts-ignore
import moment from 'moment';
import { RTMClient, WebClient } from '@slack/client';
import * as schedule from 'node-schedule';
import { getMemberName, getMemberIcon } from '../lib/slackUtils';

require('dotenv').config();

interface SlackInterface {
	rtmClient: RTMClient;
    webClient: WebClient;
    eventClient: any;
}

interface Reaction {
    name: string;
    count: number;
    users: string[];
}

interface Message {
    reactions: Reaction[] | undefined;
    ts: string;
    user: string | undefined; // exists only when the user is not a bot
    username: string | undefined; // exists only when the user is a bot
    subtype: string | undefined;  // exists only when the user is a bot
    text: string;
    client_msg_id: string;
    type: string;
}

interface Result extends Message {
    keyReaction: string;
    numberOfKeyReaction: number;
}

const searchMessagesByReaction = (reaction: string, date: moment.Moment): Result[] | undefined => {
    const filename = `${__dirname}/sandbox-log/${date.format('YYYY-MM-DD')}.json`;
    if (fs.existsSync(filename)) {
        const messages = JSON.parse(fs.readFileSync(filename, 'utf-8')) as Message[];
        const hitMessages: Result[] = [];
        for (const message of messages) {
            if (message.reactions) { // It has at least one reaction
                const targetReaction = message.reactions.find(gotReaction => gotReaction.name === reaction) as Reaction;
                if (targetReaction) { // It has the specified reaction
                    hitMessages.push({
                        ...message,
                        keyReaction: targetReaction.name,
                        numberOfKeyReaction: targetReaction.count,
                    });
                }
            } 
        }
        return hitMessages;
    }
        return undefined;
};

const postReportToSlack = async (reaction: string, lastYearDate: moment.Moment, slack: SlackInterface) => {
    const sandbox = process.env.CHANNEL_SANDBOX;
    const results = searchMessagesByReaction(reaction, lastYearDate);
    let text;
    if (results.length === 0) {
        text = `1年前の今日は :${reaction}: を獲得した投稿はなかったよ:innocent:`;
    } else {
        text = `1年前の今日 :${reaction}: を獲得した投稿を貼るよ〜 :sunglasses: `;
        switch (reaction) {
            case 'koresuki':
                text += '好きの気持ちを忘れずにいたいね :two_hearts:';
                break;
            case 'shirimetsuretsu':
                text += '何がしたかったんだろうね :thinking_face:';
                break;
            case 'yakuza':
                text += 'このような反社会的発言を一生許してはいけないね :rage:'
                break;
        }
    }
    const attachments = [];
    for (const result of results) {
        const attachment = {
            text: result.text,
            footer: `<https://slack-log.tsg.ne.jp/${sandbox}/${result.ts}|slack-log>`,
            ts: result.ts,
        };
        if (result.user) {
            const author_name = await getMemberName(result.user);
            const author_icon = await getMemberIcon(result.user);
            attachments.push({ author_name, author_icon, ...attachment });
        }
        if (result.subtype === 'bot_message') {
            attachments.push({ author_name: result.username, ...attachment});
        }
    }
    await slack.webClient.chat.postMessage( {
        channel: sandbox,
        username: '1年前の今日',
        icon_emoji: `:${reaction}:`,
        text,
        attachments,
    });
};

export default async (slack: SlackInterface) => {
    const sandbox = process.env.CHANNEL_SANDBOX;
    schedule.scheduleJob('0 0 * * *', async date => {
        const lastYearDate = moment(date).subtract(1, 'year');
        for (const reaction of ['koresuki', 'shirimetsuretsu', 'yakuza']) {
            await postReportToSlack(reaction, lastYearDate, slack);
        }
    });
    slack.rtmClient.on('message', async message => {
        if (message.channel !== sandbox) {
            return;
        }
        if (!message.text) {
            return;
        }
        if (message.text.startsWith('@remember ')) {
            const keyword = message.text.split(' ')[1];
            let isValid = true;
            const blackList = '`~!@#$%^&*()=;:[{]}|,<.>/?"'.split('');
            for (const str of blackList) {
                if (keyword.includes(str)) {
                    isValid = false
                }
            }
            if (isValid) {
                const lastYearDate = moment().subtract(1, 'year');
                await postReportToSlack(keyword, lastYearDate, slack);
            } else {
                slack.webClient.chat.postMessage({
                    channel: sandbox,
                    username: '1年前の今日',
                    icon_emoji: `:rage:`,
                    text: '悪だくみをしてはいけないよ :rage:',
                });
            }
        }
    });
};