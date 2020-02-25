import scrapeIt from 'scrape-it';
import type {SlackInterface} from '../lib/slack';
import {last, escapeRegExp} from 'lodash';
import plugin from 'fastify-plugin';
import {getMemberName, getMemberIcon} from '../lib/slackUtils'

const normalizeMeaning = (input: string) => {
  let meaning = input;
  meaning = meaning.replace(/&nbsp;/g, ' ');
  meaning = meaning.replace(/\s*\[.+?\]\s*/g, '');
  meaning = meaning.replace(/（/g, '(');
  meaning = meaning.replace(/）/g, ')');
  meaning = meaning.replace(/\s*\(.+?\)\s*/g, '');
  meaning = meaning.replace(/（.+?）/g, '');
  meaning = meaning.replace(/【.+?】/g, '');
  if (meaning.includes('とは、')) {
    meaning = meaning.replace(/^.*?とは、/, '');
  } else if (meaning.includes('とは，')) {
    meaning = meaning.replace(/^.*?とは，/, '');
  } else if (meaning.includes('は、')) {
    meaning = meaning.replace(/^.*?は、/, '');
  } else if (meaning.includes('とは')) {
    meaning = meaning.replace(/^.*?とは/, '');
  }
  meaning = meaning.replace(/であり、.+$/, '');
  meaning = meaning.replace(/であるが、.+$/, '');
  meaning = meaning.replace(/のこと(?!わざ).+$/, '');
  meaning = meaning.replace(/を指す.+$/, '');
  meaning = meaning.replace(/^== (.+?) ==$/g, '$1');
  meaning = meaning.replace(/。[^」』].*$/, '');
  meaning = meaning.replace(/^\*/, '');
  meaning = meaning.replace(/^[\d０-９][\.．\s]/, '');
  meaning = meaning.trim().replace(/(のこと|の事|をいう|である|です|を指す|とされ(る|ます)|とされてい(る|ます)|、|。)+$/, '');
  meaning = meaning.replace(/(の一つ|のひとつ|の１つ)$/, 'の1つ');
  meaning = meaning.replace(/(の1人|のひとり|の１人)$/, 'の一人');
  meaning = meaning.replace(/(の1種|の１種)$/, 'の一種');
  return meaning.trim();
};

const extractMeaning = (description: string): string => {
  const match = description.match(/^.+?(とは\?(?<reference>.+?)。|の意味は)(?<meaning>.+)$/);
  if (match === null) {
    return 'わからん';
  }
  const {groups: {reference, meaning}} = match;
  if (reference && reference.endsWith('用語')) {
    return `${reference}。${normalizeMeaning(meaning)}。`;
  }
  return `${normalizeMeaning(meaning)}。`;
};

interface Word {
  word: string;
  description: string;
}

const randomWord = async (): Promise<Word> => {
  const response = await scrapeIt<Word>(
    'https://www.weblio.jp/WeblioRandomSelectServlet',
    {
      word: {
        selector: 'h2.midashigo',
        attr: 'title',
      },
      description: {
        selector: 'meta[name=description]',
        attr: 'content',
      },
    }
  );
  const description = extractMeaning(response.data.description);
  return {
    word: response.data.word,
    description,
  };
};

const sleepFor = (duration: number): Promise<void> =>
  new Promise(resolve => { setTimeout(resolve, duration) });

const composePost = async (message: string): Promise<string> => {
  if (message === '') {
    const {word} = await randomWord();
    return word;
  }
  let first = true;
  let match;
  while ((match = /{[^{}]*}/.exec(message)) != null) {
    if (!first)
      await sleepFor(5000);
    first = false;
    const {word} = await randomWord();
    if (match[0] === '{}')
      message = message.replace('{}', word);
    else
      message = message.replace(new RegExp(escapeRegExp(match[0]), 'g'), word);
  }
  return message;
};

const randomInterval = () =>
  1000 * 60 * (90 + (Math.random() - 0.5) * 2 * 60);

export const server = ({rtmClient: rtm, webClient: slack}: SlackInterface) => plugin (async (fastify, opts, next) => {
  const postWord = async () => {
    const {word, description} = await randomWord();
    await slack.chat.postMessage({
      channel: process.env.CHANNEL_SANDBOX,
      icon_emoji: ':context:',
      username: 'context free bot',
      text: word,
    });
    await sleepFor(10 * 1000);
    await slack.chat.postMessage({
      channel: process.env.CHANNEL_SANDBOX,
      icon_emoji: ':man_dancing_2:',
      username: '通りすがりに context free bot の解説をしてくれるおじさん',
      text: `${word}: ${description}`,
    });
  };
  const repeatPost = () => {
    postWord();
    setTimeout(repeatPost, randomInterval());
  };
  rtm.on('message', async message => {
    if (message.channel !== process.env.CHANNEL_SANDBOX
        || message.subtype === 'bot_message')
      return;
    if (/^\s*@cfb(\s.*)?$/.exec(message.text) != null)
      postWord();
  });
  setTimeout(repeatPost, randomInterval());
  const {team: tsgTeam}: any = await slack.team.info();
  fastify.post('/slash/context-free-post', async (request, response) => {
    if (request.body.token !== process.env.SLACK_VERIFICATION_TOKEN) {
      response.code(400);
      return 'Bad Request';
    }
    if (request.body.team_id !== tsgTeam.id) {
      response.code(200);
      return '/cfp is only for TSG. Sorry!';
    }
    const username = await getMemberName(request.body.user_id);
    const icon_url = await getMemberIcon(request.body.user_id, 512);
    composePost(request.body.text).then(text => {
      slack.chat.postMessage({
        username,
        icon_url,
        channel: request.body.channel_id,
        text,
      });
    });
    return '';
  });
});
