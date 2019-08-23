import fs from 'fs';
import path from 'path';
// @ts-ignore
import logger from '../lib/logger.js';
import {RTMClient, WebClient} from '@slack/client';
//@ts-ignore
import {stripIndent} from 'common-tags';
import {_} from 'lodash';

type EmojiName = string;
type EmojiContent = EmojiName[][];

interface BigEmoji {
  content: EmojiContent;
  height: number;
  width: number;
}

type EmojiTable = Map<EmojiName, BigEmoji>;

const emojiFromContent = (content: EmojiContent): BigEmoji => (
  {
    content,
    height: content.length,
    width: Math.max(...content.map(x => x.length));
  }
);

const emojiData = 'bigemojis.json';
const emojiPath = path.resolve(__dirname, emojiData);

const logError = (err: Error, mesg: string): void => {
  logger.error(`emoxpand: ${mesg} : ${err.name} ${err.message}`);
};

const loadEmojis = (): EmojiTable => {
  let emojis = new Map;
  if (!fs.existsSync(emojiPath)) {
    logger.error("emoji file not found");
    return emojis;
  }
  const obj = JSON.parse(fs.readFileSync(emojiPath, 'utf8'));
  logger.info('emoxpand: loading big emojis...');
  for (const name in obj)
    emojis.set(name, emojiFromContent(obj[name]));
  return emojis;
};

const storeEmojis = (emojis: EmojiTable): void => {
  let obj: {[key: string]: EmojiContent} = {};
  for (const [name, emoji] of emojis)
    obj[name] = emoji.content;
  fs.writeFile(emojiPath, JSON.stringify(obj), err => {
    if (err !== null) {
      logError(err, 'failed to write big emojis');
      return;
    }
    logger.info('emoxpand: saving big emojis...');
  });
};

let emojis : EmojiTable = loadEmojis();

const addEmoji = (name: EmojiName, emoji: BigEmoji): void => {
  emojis.set(name, emoji);
  storeEmojis(emojis);
};

interface SlackInterface {
  rtmClient: RTMClient;
  webClient: WebClient;
}

interface WaitingContent {
  name: EmojiName;
}
type RegistrationState = 'WaitingRegistration' | 'WaitingName' | WaitingContent;

let state: RegistrationState = 'WaitingRegistration';

export default ({rtmClient: rtm, webClient: slack}: SlackInterface) => {
  const postMessage = (text: string): void => {
    slack.chat.postMessage({
      channel: process.env.CHANNEL_SANDBOX,
      text,
      username: 'BigEmojier',
      icon_emoji: ':chian-ga-aru:',
    });
  };
  
  const is_in_sandbox = (message: any) =>
    message.channel === process.env.CHANNEL_SANDBOX;

  rtm.on('message', async message => {
    if (!is_in_sandbox(message))
      return;

    if (message.text === 'やーめた') {
      postMessage(':OK:');
      state = 'WaitingRegistration';
      return;
    }

    switch (state) {
      case 'WaitingRegistration':
        if (!/^大(絵文字|emoji)登録$/.test(message.text))
          return;
        state = 'WaitingName';
        postMessage(':wai: 絵文字の名前:ha:');
        break;
      case 'WaitingName':
        {
          const match = /^!([^!:\s]+)!$/.exec(message.text);
          if (!match) return;
          state = { name: match[1] }
          postMessage(':waiwai: 本体:ha:');
        }
        break;
      default:
        {
          const match = /^(:[^:!\s]+:(\n?:[^:!\s]+:)*)$/.exec(message.text);
          if (!match) return;
          const content = match[1]
            .split('\n')
            .map(row =>
              row.slice(1, row.length - 1).split('::'));
          addEmoji(state.name, emojiFromContent(content));
          postMessage(stripIndent`
大絵文字 \`!${state.name}!\`
${match[1]}
が登録されました:sushi-go-left::waiwai::saikou::chian-ga-aru::sushi-go-right:`);
          state = 'WaitingRegistration';
        }
        break;
    }
  });
};
