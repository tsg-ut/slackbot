import {promises as fs} from 'fs';
import path from 'path';
import plugin from 'fastify-plugin';
import _ from 'lodash';
import logger from '../lib/logger';
/* eslint-disable no-unused-vars */
import type {SlackInterface, SlashCommandEndpoint} from '../lib/slack';
import {getMemberName, getMemberIcon} from '../lib/slackUtils';

const log = logger.child({bot: 'emoxpand'});

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
    width: Math.max(...content.map((x) => x.length)),
  }
);

const bigemojify = (smallEmoji: EmojiName): BigEmoji =>
  emojiFromContent([[smallEmoji]]);

const logError = (err: Error, mesg: string): void => {
  log.error(`emoxpand: ${mesg} : ${err.name} ${err.message}`);
};

// Emoji saving {{{
const emojiData = 'bigemojis.json';
const emojiPath = path.resolve(__dirname, emojiData);

let allEmojis : EmojiTable = new Map();

const loadEmojis = async () => {
  allEmojis = new Map();
  const data = await fs.readFile(emojiPath, {encoding: 'utf8'});
  const obj: {[key: string]: EmojiContent} = JSON.parse(data);
  log.info('emoxpand: loading big emojis...');
  for (const [name, content] of Object.entries(obj)) {
    allEmojis.set(name, emojiFromContent(content));
  }
  return allEmojis;
};

loadEmojis();

const emojisToJson = (emojis: EmojiTable): string => {
  const obj = Object.fromEntries(
    Array.from(emojis, ([name, emoji]) => [name, emoji.content])
  );
  return JSON.stringify(obj);
};

const storeEmojis = (emojis: EmojiTable): void => {
  fs.writeFile(emojiPath, emojisToJson(emojis));
};


const addEmoji = (name: EmojiName, emoji: BigEmoji): void => {
  allEmojis.set(name, emoji);
  storeEmojis(allEmojis);
};
// }}}

// expansion {{{
const alignEmojis = (es: BigEmoji[]): string[] => {
  if (es.length === 0) {
    return [''];
  }
  const wholeHeight = Math.max(...es.map((e) => e.height));
  const voids = (width: number) => Array(width).fill('_');
  const emojiBlocks = es
    .map(({width, height, content}) =>
      content
        .concat(Array(wholeHeight - height).fill(0).map((_): string[] => []))
        .map((row) => row
          .concat(voids(width - row.length))
          .map((emoji) => `:${emoji}:`)
          .join('')));
  return _.zipWith(...emojiBlocks, (...rows) => rows.join(''));
};

type TokenType = 'Plain' | 'Emoji' | 'BigEmoji';
interface Token {
  kind: TokenType
  content: string;
}


const expandEmoji = (text: string): string =>
  _.flatMap(text.split('\n'), (line) => {
    const [, , tokens] = (line + '\n').split('').reduce<[TokenType, string[], Token[]]>(
      ([parsing, chars, parsed], ch) => {
        const push = () => {
          if (chars.length === 0) {
            return;
          }
          const content = chars.join('');
          if (parsing === 'BigEmoji' && !allEmojis.has(content)) {
            parsed.push({
              kind: 'Plain',
              content: '!' + content + '!',
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
            break;
          case '!':
            if (parsing === 'Plain') {
              push();
              return ['BigEmoji', [], parsed];
            }
            else if (parsing === 'BigEmoji') {
              push();
              return ['Plain', [], parsed];
            }
            break;
          case '\n':
            push();
            return ['Plain', [], parsed];
        }
        chars.push(ch);
        return [parsing, chars, parsed];
      },
      ['Plain', [], []]
    );
    if (tokens[tokens.length - 1].kind !== 'Plain') {
      tokens.push({kind: 'Plain', content: ''});
    }
    return tokens.reduce(
      ([inLine, lines], tok: Token) => {
        if (tok.kind === 'Plain') {
          const emojiLines = alignEmojis(
            inLine.map(({kind, content}) =>
              kind === 'Emoji' ? bigemojify(content) : allEmojis.get(content))
          );
          emojiLines[0] += tok.content;
          lines.push(emojiLines.join('\n'));
          return [[], lines];
        }
        inLine.push(tok);
        return [inLine, lines];
      },
      [[], []]
    )[1];
  }).join('\n');

// }}}

export const server = ({eventClient, webClient: slack}: SlackInterface) => plugin(async (fastify) => {
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
  fastify.post<SlashCommandEndpoint>('/slash/emoxpand', async (request, response) => {
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
      icon_url: await getMemberIcon(request.body.user_id, 192),
    });
    return '';
  });
  // }}}

  // Emoji list API {{{
  fastify.get('/emoxpand/list', (_, response) => {
    response.header('Content-Type', 'applicaton/json').code(200);
    return Promise.resolve(emojisToJson(allEmojis));
  });
  // }}}

  // Big Emoji registration {{{
  interface WaitingContent {
    name: EmojiName;
  }

  type RegistrationState = 'WaitingRegistration' | 'WaitingName' | WaitingContent;

  let state: RegistrationState = 'WaitingRegistration';

  /* eslint-disable require-await */
  eventClient.on('message', async (message) => {
    if (message.channel !== process.env.CHANNEL_SANDBOX) {
      return;
    }

    // Big Emoji list {{{
    if (/^大(?:絵文字|emoji)一覧$/.test(message.text)) {
      const emojiNames = Array.from(allEmojis.keys());
      if (emojiNames.length === 0) {
        postMessage('登録されている大絵文字はありません');
      }
      else {
        const list = emojiNames.map((name) => `\`!${name}!\``).join(' ');
        postMessage(`登録されている大絵文字一覧:\n${list}`);
      }
      return;
    }
    // }}}

    if (state !== 'WaitingRegistration' &&
        message.text === 'やーめた') {
      postMessage(':OK:');
      state = 'WaitingRegistration';
      return;
    }

    switch (state) {
      case 'WaitingRegistration':
        if (!/^大(?:絵文字|emoji)登録$/.test(message.text)) {
          return;
        }
        state = 'WaitingName';
        postMessage(':wai: 絵文字の名前:ha:');
        break;
      case 'WaitingName':
        {
          const match = /^!(?<name>[^!:\s]+)!$/.exec(message.text);
          if (!match) {
            return;
          }
          state = {name: match.groups.name};
          postMessage(':waiwai: 本体:ha:');
        }
        break;
      default:
        {
          const match = /^(?<content>:[^:!\s]+:(?:\n?:[^:!\s]+:)*)$/.exec(message.text);
          if (!match) {
            return;
          }
          const contentLines = match.groups.content
            .split('\n')
            .map((row) =>
              row.slice(1, row.length - 1).split('::'));
          addEmoji(state.name, emojiFromContent(contentLines));
          postMessage(`大絵文字 \`!${state.name}!\`
${match.groups.content}
が登録されました:sushi-go-left::waiwai::saikou::chian-ga-aru::sushi-go-right:`);
          state = 'WaitingRegistration';
        }
        break;
    }
    // }}}
  });
});

