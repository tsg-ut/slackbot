import fs from 'fs';
import path from 'path';
// @ts-ignore
import logger from '../lib/logger.js';
import {RTMClient, WebClient} from '@slack/client';
import * as _ from 'lodash';
import plugin from 'fastify-plugin';
import {getMemberName, getMemberIcon} from '../lib/slackUtils'

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

const logError = (err: Error, mesg: string): void => {
  logger.error(`emoxpand: ${mesg} : ${err.name} ${err.message}`);
};

// Emoji saving {{{
const emojiData = 'bigemojis.json';
const emojiPath = path.resolve(__dirname, emojiData);

let emojis : EmojiTable = new Map;

const loadEmojis = () => {
  emojis = new Map;
  fs.readFile(emojiPath, 'utf8', (err, data) => {
    if (err) {
      logError(err, 'could not read emojis');
      return;
    }
    const obj = JSON.parse(data);
    logger.info('emoxpand: loading big emojis...');
    for (const name in obj)
      emojis.set(name, emojiFromContent(obj[name]));
    return emojis;
  });
};

loadEmojis();

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


const addEmoji = (name: EmojiName, emoji: BigEmoji): void => {
  emojis.set(name, emoji);
  storeEmojis(emojis);
};
// }}}

// expansion {{{
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
          .map(emoji => `:${emoji}:`)
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
          if (chars.length === 0) return;
          const content = chars.join('');
          if (parsing === 'BigEmoji' && !emojis.has(content)) {
            parsed.push({
              kind: 'Plain',
              content: '!' + content + '!'
            });
          }
          else {
            parsed.push({
              kind: parsing,
              content: chars.join(''),
            });
          }
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

//}}}

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
  const {team: tsgTeam}: any = await slack.team.info();
  fastify.post('/slash/emoxpand', async (request, response) => {
    if (request.body.token !== process.env.SLACK_VERIFICATION_TOKEN) {
      response.code(400);
      return 'Bad Request';
    }
    if (request.body.team_id !== tsgTeam.id) {
      response.code(200);
      return '/emoxpand is only for TSG. Sorry!';
    }
    slack.chat.postMessage({
      channel: request.body.channel_id,
      text: expandEmoji(request.body.text),
      username: await getMemberName(request.body.user_id),
      icon_url: await getMemberIcon(request.body.user_id),
    });
    return '';
  });
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
          postMessage(`大絵文字 \`!${state.name}!\`
${match[1]}
が登録されました:sushi-go-left::waiwai::saikou::chian-ga-aru::sushi-go-right:`);
          state = 'WaitingRegistration';
        }
        break;
    }
    // }}}

  });
});

