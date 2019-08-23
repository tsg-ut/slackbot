import fs from 'fs';
import path from 'path';
// @ts-ignore
import logger from '../lib/logger.js';
import {RTMClient, WebClient} from '@slack/client';
//@ts-ignore
import {stripIndent} from 'common-tags';
import * as _ from 'lodash';
import plugin from 'fastify-plugin';

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
    width: Math.max(...content.map(x => x.length)),
  }
);

const bigemojify = (smallEmoji: EmojiName): BigEmoji =>
  emojiFromContent([[smallEmoji]]);

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

const alignEmojis = (es: BigEmoji[]): string[] => {
  if (es.length === 0) return [''];
  const wholeHeight = Math.max(...es.map(e => e.height));
  const voids = (width: number) => Array(width).fill('_');
  const filled = es
    .map(({width, height, content}) =>
      content
        .concat(Array(wholeHeight - height).fill(0).map(x => []))
        .map(row => row
          .concat(Array(width - row.length).fill('_'))
          .join('')));
  return _.zipWith(...filled, (...rows) => rows.join(''));
};

type TokenType = 'Plain' | 'Emoji' | 'BigEmoji';
interface Token {
  kind: TokenType
  content: string;
}


const expandEmoji = (text: string): string =>
  _.flatMap(text.split('\n'), line => {
    const tokens: Token[] = (line + '\n').split('').reduce<[TokenType, string[], Token[]]>(
      ([parsing, chars, parsed], ch) => {
        const push = () => {
          parsed.push({
            kind: parsing,
            content: chars.join(''),
          });
        };
        switch (ch) {
          case ':':
            if (parsing === 'Plain') {
              push();
              return ['Emoji', [], parsed];
            }
            else if (parsing === 'Emoji') {
              push();
              return ['Plain', [], parsed];
            }
          case '!':
            if (parsing === 'Plain') {
              push();
              return ['BigEmoji', [], parsed];
            }
            else if (parsing === 'BigEmoji') {
              push();
              return ['Plain', [], parsed];
            }
          case '\n':
            push();
            return ['Plain', [], parsed];
        }
        chars.push(ch);
        return [parsing, chars, parsed];
      },
      ['Plain', [], []])[2];
    if (tokens[tokens.length - 1].kind !== 'Plain')
      tokens.push({ kind: 'Plain', content: '', });
    return tokens.reduce(
      ([inLine, lines], tok: Token) => {
        if (tok.kind === 'Plain') {
          const emojiStr = alignEmojis(
            inLine.map(({kind, content}) => 
              kind === 'Emoji' ? bigemojify(content) : emojis.get(content)))
          emojiStr[0] += tok.content;
          lines.push(emojiStr.join('\n'));
          return [[], lines];
        }
        inLine.push(tok);
        return [inLine, lines];
      },
      [[], []])[1];
  }).join('\n');

interface SlackInterface {
  rtmClient: RTMClient;
  webClient: WebClient;
}

export const server = ({rtmClient: rtm, webClient: slack}: SlackInterface) => plugin(async (fastify, opts, next) => {
  const postMessage = (text: string): void => {
    slack.chat.postMessage({
      channel: process.env.CHANNEL_SANDBOX,
      text,
      username: 'BigEmojier',
      icon_emoji: ':chian-ga-aru:',
    });
  };
  // Big Emoji expansion {{{

  // }}}
  
  // Big Emoji registration {{{
  interface WaitingContent {
    name: EmojiName;
  }

  type RegistrationState = 'WaitingRegistration' | 'WaitingName' | WaitingContent;

  let state: RegistrationState = 'WaitingRegistration';

  rtm.on('message', async message => {
    if (message.channel !== process.env.CHANNEL_SANDBOX)
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
          postMessage(String.raw`大絵文字 \`!${state.name}!\`
${match[1]}
が登録されました:sushi-go-left::waiwai::saikou::chian-ga-aru::sushi-go-right:`);
          state = 'WaitingRegistration';
        }
        break;
    }
    // }}}

  });
});

