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

const randomInterval = () =>
    1000 * 60 * (90 + (Math.random() - 0.5) * 2 * 60);

interface SlackInterface {
    rtmClient: RTMClient;
    webClient: WebClient;
}
    
export default async ({rtmClient: rtm, webClient: slack}: SlackInterface) => {
    async function postWord() {
	const word = await randomWord();
	slack.chat.postMessage({
	    channel: process.env.CHANNEL_SANDBOX,
	    icon_emoji: ':context:',
	    username: 'context free bot',
	    text: word,
	})
	setTimeout(postWord, randomInterval());
    }
    setTimeout(postWord, randomInterval());
};
