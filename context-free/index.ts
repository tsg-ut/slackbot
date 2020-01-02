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
    }
  );
  return response.data.word;
};

const randomInterval = () =>
  1000 * 60 * (90 + (Math.random() - 0.5) * 2 * 60);

interface SlackInterface {
  rtmClient: RTMClient;
  webClient: WebClient;
}

export default async ({rtmClient: rtm, webClient: slack}: SlackInterface) => {
  const postWord = async () => {
    const word = await randomWord();
    slack.chat.postMessage({
      channel: process.env.CHANNEL_SANDBOX,
      icon_emoji: ':context:',
      username: 'context free bot',
      text: word,
    });
  };
  const repeatPost = () => {
    postWord();
    setTimeout(repeatPost, randomInterval());
  };
  rtm.on('message', message => {
    if (message.channel !== process.env.CHANNEL_SANDBOX
        || message.subtype === 'bot_message')
      return;
    if (/^\s*@cfb\s.*$/.exec(message.text) != null)
      postWord();
  });
  setTimeout(repeatPost, randomInterval());
};
