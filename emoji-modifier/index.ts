import {RTMClient, WebClient} from '@slack/client';
// @ts-ignore
import logger from '../lib/logger.js';
import {promisify} from 'util';
import {EmojiData} from 'emoji-data-ts';
import {getEmoji} from '../lib/slackUtils';
import axios from 'axios';
import * as sharp from 'sharp';
import * as _ from 'lodash';
import {GifFrame, GifSpec, GifCodec} from 'gifwrap';
// @ts-ignore
import {v2 as cloudinary} from 'cloudinary';

// emoji type definition {{{
interface EmodiError {
  kind: 'error';
  message: string;
}

interface StaticEmoji {
  kind: 'static';
  image: Buffer;
}

interface GifEmoji {
  kind: 'gif';
  frames: GifFrame[];
  options: GifSpec;
}

type Emoji = StaticEmoji | GifEmoji;
// }}}

// emoji download/upload {{{
const downloadEmoji = async (url: string): Promise<Emoji> => {
  const response = await axios.get(
    url,
    { responseType: 'arraybuffer' });
  const data = Buffer.from(response.data);
  if (response.headers['content-type'] === 'image/gif') {
    const codec = new GifCodec;
    const gif = await codec.decodeGif(data);
    return {
      kind: 'gif',
      frames: gif.frames,
      options: gif,
    };
  }
  else return {
    kind: 'static',
    image: data,
  };
};


const emojiData = new EmojiData();
let team_id: string = null;

const lookupEmoji = async (name: string): Promise<Emoji> => {
	const emojiURL = await getEmoji(name, team_id);
	if (emojiURL != null) {
		return await downloadEmoji(emojiURL);
	}
	const defaultEmoji = emojiData.getImageData(name);
	if (defaultEmoji != null) {
		const url = `https://raw.githubusercontent.com/iamcal/emoji-data/master/img-apple-64/${defaultEmoji.imageUrl}`;
    return await downloadEmoji(url);
	}
	return null;
};

const uploadImage = async (image: Buffer): Promise<string> => {
  const response = await new Promise((resolve, reject) => {
    cloudinary.uploader.upload_stream((error: any, data: any) => {
      if (error) reject(error);
      else resolve(data);
    }).end(image);
  });
  // @ts-ignore
  return response.secure_url;
};

const uploadEmoji = async (emoji: Emoji): Promise<string>  => {
  if (emoji.kind === 'static')
      return await uploadImage(emoji.image);
  else {
    const codec = new GifCodec;
    const gif = await codec.encodeGif(emoji.frames, emoji.options);
    return await uploadImage(gif.buffer);
  }
};
// }}}

// filters {{{
type Argument = number | string;
type ArgumentType = 'number' | 'string';

interface Filter {
  arguments: ArgumentType[];
  filter: (emoji: Emoji, args: Argument[]) => Emoji | EmodiError;
}

const framewise = (emoji: Emoji, frameOp: (frame: Buffer) => Buffer): Emoji => {
  switch (emoji.kind) {
    case 'static':
      return {
        kind: 'static',
        image: frameOp(emoji.image),
      };
      break;
    case 'gif':
      return {
        kind: 'gif',
        frames: emoji.frames.map(frame => {
          frame.bitmap.data = frameOp(frame.bitmap.data)
          return frame;
        }),
        options: emoji.options,
      };
      break;
  }
};

const simpleFilter = (f: (frame: Buffer) => Buffer): Filter => ({
  arguments: [],
  filter: (emoji: Emoji) => framewise(emoji, f),
});


const filters: Map<string,  Filter> = new Map([
  ['identity', simpleFilter(_.identity)],
  ['speedTimes', {
    arguments: ['number'],
    filter: (emoji: Emoji, [mult]: [number]) => {
      if (emoji.kind == 'static') return emoji;
      return {
        ...emoji,
        frames: emoji.frames.map(frame => {
          frame.delayCentisecs /= mult;
          return frame;
        }),
      };
    },
  }],
]);
// }}}

// parsing & executing {{{
interface Transformation {
  kind: 'success';
  emojiName: string;
  filters: [string, string[]][];
}
const errorOfKind = (kind: string): ((message: string) => EmodiError) => message => ({
  kind: 'error',
  message: kind + ': ' + message + ':cry:',
});

type ParseResult = Transformation | EmodiError;
// TODO: allow string arguments to contain spaces
const parse = (message: string): ParseResult => {
  const parseError = errorOfKind('ParseError');
  const parts = message.split('|').map(_.trim);
  if (parts.length < 1)
    return parseError('Expected emoji');
  const nameMatch = /^:([^!:\s]+):$/.exec(parts[0]);
  if (nameMatch == null)
    return parseError(`${parts[0]} is not a valid emoji name`);
  let error: EmodiError = null;
  const appliedFilters: [string, string[]][] = parts.slice(1).map(part => {
    const tokens = part.split(/\s/).filter(s => s !== '');
    if (tokens.length < 1) {
      error = parseError('Empty filter');
      return undefined;
    }
    return [tokens[0], tokens.slice(1)];
  });
  if (error != null) return error;
  return {
    kind: 'success',
    emojiName: nameMatch[1],
    filters: appliedFilters,
  };
};

const runTransformation = async (message: string): Promise<Emoji | EmodiError> => {
  const parseResult = parse(message);
  if (parseResult.kind === 'error')
    return parseResult;
  const nameError = errorOfKind('NameError');
  const emoji = await lookupEmoji(parseResult.emojiName);
  if (emoji == null)
    return nameError(`:${parseResult.emojiName}: : No such emoji`);
  const typeError = errorOfKind('TypeError');
  let error: EmodiError = null;
  const filterFuns = parseResult.filters.map(([name, args]) => {
    const filter = filters.get(name);
    if (filter == null) {
      error = nameError(`${name}: No such filter`);
      return null;
    }
    const argTypes = filter.arguments;
    if (args.length !== argTypes.length) {
      const plural = argTypes.length > 1 ? 's' : '';
      error = typeError(`${name} expects ${argTypes.length} argument${plural}, but got ${args.length}`);
      return null;
    }
    const typeMismatch = _.zipWith(args, argTypes, (arg, type) => {
      if (type === 'string' || !isNaN(_.toNumber(arg))) return null;
      return typeError(`${arg} is not a number`);
    }).reduce((a, b) => a || b, null);
    if (typeMismatch !=  null) {
      error = typeMismatch;
      return null;
    }
    return (emoji: Emoji) => filter.filter(emoji, args);
  });
  if (error != null) return error;
  return filterFuns.reduce(
    (emoji, func) => {
      if (emoji.kind == 'error') return emoji;
      return func(emoji);
    },
    emoji as Emoji | EmodiError);
};

// }}}

// user interaction {{{
interface SlackInterface {
  rtmClient: RTMClient;
  webClient: WebClient;
}

export default async ({rtmClient: rtm, webClient: slack}: SlackInterface) => {
  const {team}: any = await slack.team.info();
  team_id = team.id;
  const postImage = (url: string): void => {
    slack.chat.postMessage({
      channel: process.env.CHANNEL_SANDBOX,
      username: 'emoji-modifier',
      icon_emoji: ':fish:',
      text: ':waiwai:',
      attachments: [{
        image_url: url,
        fallback: 'emoji-modifier',
      }],
    });
  };
  const postError = (message: string): void => {
    slack.chat.postMessage({
      channel: process.env.CHANNEL_SANDBOX,
      username: 'emoji-modifier',
      icon_emoji: ':yokunasasou:',
      text: message,
    });
  }

  rtm.on('message', async message => {
    if (message.channel !== process.env.CHANNEL_SANDBOX
      || message.subtype === 'bot_message')
      return;

    const operation = /^@emodi\s((.|\n)*)$/.exec(message.text);
    if (operation == null)
      return;

    const result = await runTransformation(operation[1]);
    if (result.kind == 'error')
      postError(result.message);
    else {
      const url = await uploadEmoji(result);
      postImage(url);
    }
  });
};
// }}}
