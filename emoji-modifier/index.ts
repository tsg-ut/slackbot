import {RTMClient, WebClient} from '@slack/client';
// @ts-ignore
import logger from '../lib/logger.js';
import {promisify} from 'util';
import {EmojiData} from 'emoji-data-ts';
import {getEmoji} from '../lib/slackUtils';
import axios from 'axios';
import sharp from 'sharp';
import * as _ from 'lodash';
import {GifFrame, GifSpec, GifCodec} from 'gifwrap';
import * as iq from 'image-q';
// @ts-ignore
import {v2 as cloudinary} from 'cloudinary';

// emoji type definition {{{
interface EmodiError {
  kind: 'error';
  message: string;
}

const errorOfKind = (kind: string): ((message: string) => EmodiError) => message => ({
  kind: 'error',
  message: kind + ': ' + message + ':cry:',
});

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

const trailAlias = async (name: string): Promise<string> => {
  const match = /alias:(.+)/.exec(name);
  return match == null ? name : await getEmoji(match[1], team_id)
}

const lookupEmoji = async (name: string): Promise<Emoji> => {
  const emojiURL = await getEmoji(name, team_id);
  if (emojiURL != null) {
    const realURL = await trailAlias(emojiURL)
    return await downloadEmoji(realURL);
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
    // @ts-ignore it seems that cloudinary type definitions are not accurate
    cloudinary.uploader.upload_stream((error: any, data: any) => {
      if (error) reject(error);
      else resolve(data);
    }).end(image);
  });
  // @ts-ignore
  return response.secure_url;
};

const quantizeColor = async (frame: GifFrame): Promise<GifFrame> => {
  const {colors, usesTransparency, indexCount} = frame.getPalette();
  if (indexCount <= 256) return frame;
  const maxColors = usesTransparency ? 255 : 256;
  const pointContainer = iq.utils.PointContainer.fromBuffer(
    frame.bitmap.data,
    frame.bitmap.height,
    frame.bitmap.width);
  const palette = await iq.buildPalette([pointContainer], {colors: maxColors});
  const processed = await iq.applyPalette(pointContainer, palette);
  frame.bitmap.data = Buffer.from(processed.toUint8Array());
  return frame;
};

const uploadEmoji = async (emoji: Emoji): Promise<string>  => {
  if (emoji.kind === 'static')
      return await uploadImage(emoji.image);
  else {
    const quantizedFrames = new Array(emoji.frames.length);
    for (const i of quantizedFrames.keys())
      quantizedFrames[i] = await quantizeColor(emoji.frames[i]);
    const codec = new GifCodec;
    const gif = await codec.encodeGif(quantizedFrames, emoji.options);
    return await uploadImage(gif.buffer);
  }
};
// }}}

// filters {{{
type Argument = number | string;
type ArgumentType = 'number' | 'string';

interface Filter {
  arguments: ArgumentType[];
  filter: (emoji: Emoji, args: Argument[]) => Promise<Emoji | EmodiError>;
}

type frameFilter = (frame: Buffer, sharpOpts?: sharp.Raw) => Promise<Buffer>

const framewise = async (emoji: Emoji, frameOp: frameFilter): Promise<Emoji> => {
  switch (emoji.kind) {
    case 'static':
      return {
        kind: 'static',
        image: await frameOp(emoji.image),
      };
      break;
    case 'gif':
      return {
        kind: 'gif',
        frames: await Promise.all(emoji.frames.map(async frame => {
          const options: sharp.Raw = {
              width: frame.bitmap.width,
              height: frame.bitmap.height,
              channels: 4,
          };
          frame.bitmap.data = await frameOp(frame.bitmap.data, options);
          return frame;
        })),
        options: emoji.options,
      };
      break;
  }
};

const simpleFilter = (f: (frame: Buffer) => Promise<Buffer>): Filter => ({
  arguments: [],
  filter: async (emoji: Emoji) => await framewise(emoji, f),
});

const runtimeError = errorOfKind('RuntimeError');

const moveFromTo = async (emoji: Emoji, [from, to]: [string, string]): Promise<Emoji | EmodiError> => {
  if (emoji.kind === 'gif')
    return runtimeError('move accepts only static emoji');
  type position = 'top' | 'bottom' | 'left' | 'right';
  const positions: position[] = ['top', 'bottom', 'left', 'right'];
  const isPosition = (s: string): s is position => (positions as string[]).includes(s);
  if (!isPosition(from) || !isPosition(to))
    return runtimeError('move: expected direction (top | bottom | left | right)');
  const {width, height} = await sharp(emoji.image).metadata();
  const side = Math.max(width, height);
  const extension = { top: 0, bottom: 0, left: 0, right: 0, background: {r: 0, b: 0, g: 0, alpha: 0} };
  if (width > height) {
    const top = Math.floor((width -  height) / 2);
    extension.top = top;
    extension.bottom = width - height - top;
  }
  else {
    const left = Math.floor((height - width) / 2);
    extension.left = left;
    extension.right = height - width - left;
  }
  const resized = await sharp(emoji.image).extend(extension).png().toBuffer();
  const shift = async (pos: position, img: Buffer, frame: number): Promise<Buffer> => {
    const step = Math.round(frame * side / 12);
    const opposites = new Map<position, position>([
      ['top', 'bottom'], ['bottom', 'top'], ['left', 'right'], ['right', 'left']
    ]);
    const opposite = opposites.get(pos);
    const extend = Object.fromEntries([
      ['background', {r: 0, g: 0, b: 0, alpha: 0}],
      ...positions.map(edge => [edge, edge == opposite ? step : 0])
    ]);
    const extract = {
      top: pos == 'top' ? step : 0,
      left: pos == 'left' ? step : 0,
      width: side,
      height: side,
    };
    const extended = await sharp(img).extend(extend).toBuffer();
    return await sharp(extended).extract(extract).toBuffer();
  };
  const frames = await Promise.all(_.range(12).map(async i => {
    const [coming, going] = await Promise.all([
      shift(from, resized, 12 - i),
      shift(to, resized, i),
    ]);
    return await sharp(going).composite([{input: coming}]).raw().toBuffer();
  }));
  return {
    kind: 'gif',
    frames: frames.map(buffer => new GifFrame(side, side, buffer, { delayCentisecs: 6 })),
    options: { loops: 0 }
  };
}

const filters: Map<string,  Filter> = new Map([
  ['identity', simpleFilter(_.identity)],
  ['speedTimes', {
    arguments: ['number'],
    filter: (emoji: Emoji, [ratio]: [number]) => {
      if (emoji.kind == 'static') return emoji;
      return {
        ...emoji,
        frames: emoji.frames.map(frame => {
          // TODO: better implementation
          frame.delayCentisecs = Math.max(2, frame.delayCentisecs / ratio);
          return frame;
        }),
      };
    },
  }],
  ['mirrorV', simpleFilter((image: Buffer, raw?: sharp.Raw): Promise<Buffer> => {
    const options = raw == null ? {} : {raw};
    return sharp(image, options).flip().toBuffer();
  })],
  ['mirror', simpleFilter((image: Buffer, raw?: sharp.Raw): Promise<Buffer> => {
    const options = raw == null ? {} : {raw};
    return sharp(image, options).flop().toBuffer();
  })],
  ['move', {
    arguments: ['string', 'string'],
    filter: moveFromTo
  }],
  ['go', {
    arguments: ['string'],
    filter: async (emoji: Emoji, [direction]: [string]): Promise<Emoji | EmodiError> => {
      const opposite = new Map([
        ['top', 'bottom'], ['bottom', 'top'], ['left', 'right'], ['right', 'left']
      ]);
      const from = opposite.get(direction);
      if (from == null)
        return runtimeError('go: expected direction (top | bottom | left | right)');
      return await moveFromTo(emoji, [from, direction]);
    }
  }],
  ['trim', {
    arguments: ['number'],
    filter: async (emoji: Emoji, [threshold]: [number]): Promise<Emoji | EmodiError> => {
      return framewise(emoji, async (image: Buffer, raw?: sharp.Raw): Promise<Buffer> => {
        const options = raw == null ? {} : {raw};
        return sharp(image, options).trim(threshold).toBuffer();
      });
    }
  }],
] as [string, Filter][]);
// }}}

// parsing & executing {{{
interface Transformation {
  kind: 'success';
  emojiName: string;
  filters: [string, string[]][];
}

type ParseResult = Transformation | EmodiError;
// TODO: allow string arguments to contain spaces
const parse = (message: string): ParseResult => {
  const parseError = errorOfKind('ParseError');
  const parts = message.split('|').map(_.trim);
  logger.info(parts);
  if (parts.length < 1)
    return parseError('Expected emoji');
  const nameMatch = /^:([^!:\s]+):$/.exec(parts[0]);
  if (nameMatch == null)
    return parseError(`\`${parts[0]}\` is not a valid emoji name`);
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
    return nameError(`\`:${parseResult.emojiName}:\` : No such emoji`);
  const typeError = errorOfKind('TypeError');
  let error: EmodiError = null;
  const filterFuns = parseResult.filters.map(([name, args]) => {
    const filter = filters.get(name);
    if (filter == null) {
      error = nameError(`\`${name}\`: No such filter(Perhaps you can implement it?)`);
      return null;
    }
    const argTypes = filter.arguments;
    if (args.length !== argTypes.length) {
      const plural = argTypes.length > 1 ? 's' : '';
      error = typeError(`\`${name}\` expects ${argTypes.length} argument${plural}, but got ${args.length}`);
      return null;
    }
    const typeMismatch = _.zipWith(args, argTypes, (arg, type) => {
      if (type === 'string' || !isNaN(_.toNumber(arg))) return null;
      return typeError(`\`${arg}\` is not a number`);
    }).reduce((a, b) => a || b, null);
    if (typeMismatch !=  null) {
      error = typeMismatch;
      return null;
    }
    const convertedArgs = _.zipWith(args, argTypes, (arg, type) => {
      if (type ==  'string') return arg;
      return _.toNumber(arg);
    });
    return async (emoji: Emoji) => await filter.filter(emoji, convertedArgs);
  });
  if (error != null) return error;
  return await filterFuns.reduce(
    async (previous, func) => {
      const emoji = await previous;
      if (emoji.kind == 'error') return emoji;
      return await func(emoji);
    },
    Promise.resolve(emoji as Emoji | EmodiError));
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

    const internalError = errorOfKind('InternalError');
    const result = await runTransformation(operation[1])
      .catch(err => {
        logger.error(err.message);
        return internalError(err.name + ': ' + err.message + '\n Please inform :coil:.')
      });
    if (result.kind == 'error')
      postError(result.message);
    else {
      const url = await uploadEmoji(result);
      postImage(url);
    }
  });
};
// }}}
