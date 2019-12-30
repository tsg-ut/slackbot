import scrapeIt from 'scrape-it';
import {RTMClient, WebClient} from '@slack/client';


const randomWord = async (): Promise<string> => {
    interface wordData {
	word: string;
    }
    const response = await scrapeIt<wordData>(
	'https://www.weblio.jp/content_find/?random-select=',
	{
	    word: {
		selector: 'h2.midashigo',
		attr: 'title',
	    }
	});
    return response.data.word;
};

interface SlackInterface {
    rtmClient: RTMClient;
    webClient: WebClient;
}

let messageCount = 0;
// About 1400 messages are posted in #sandbox per day on average
const threshold = 1400 / 10;
    
export default async ({rtmClient: rtm, webClient: slack}: SlackInterface) => {
    rtm.on('message', async message => {
	if (message.channel !== process.env.CHANNEL_SANDBOX)
	    return;
	messageCount++;
	if (messageCount >= threshold) {
	    messageCount = 0;
	    const word = await randomWord();
	    slack.chat.postMessage({
		channel: process.env.CHANNEL_SANDBOX,
		icon_emoji: ':context:',
		username: 'context free',
		text: word,
	    });
	}
    });
};
