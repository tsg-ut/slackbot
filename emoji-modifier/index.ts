import axios from 'axios';
// @ts-ignore
import {v2 as cloudinary} from 'cloudinary';
import {stripIndent} from 'common-tags';
import {EmojiData} from 'emoji-data-ts';
/* eslint-disable no-unused-vars */
import {GifFrame, GifSpec, GifCodec} from 'gifwrap';
import {utils, buildPalette, applyPalette} from 'image-q';
import _ from 'lodash';
import sharp from 'sharp';
import loadFont from '../lib/loadFont';
// @ts-ignore
import logger from '../lib/logger';
/* eslint-disable no-unused-vars  */
import type {SlackInterface} from '../lib/slack';
import {getEmoji} from '../lib/slackUtils';

// emoji type definition {{{
interface EmodiError {
  kind: 'error';
  message: string;
}

const errorOfKind = (kind: string): ((message: string) => EmodiError) => (message) => ({
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
    {responseType: 'arraybuffer'}
  );
  const data = Buffer.from(response.data);
  if (response.headers['content-type'] === 'image/gif') {
    const codec = new GifCodec();
    const gif = await codec.decodeGif(data);
    return {
      kind: 'gif',
      frames: gif.frames,
      options: gif,
    };
  }
  return {
    kind: 'static',
    image: data,
  };
};


const emojiData = new EmojiData();
let team_id: string = null;

const trailAlias = (name: string): Promise<string> => {
  const match = /alias:(?<genuineName>.+)/.exec(name);
  return match == null ? Promise.resolve(name) : getEmoji(match.groups.genuineName, team_id);
};

const lookupEmoji = async (name: string): Promise<Emoji> => {
  const emojiURL = await getEmoji(name, team_id);
  if (emojiURL != null) {
    const realURL = await trailAlias(emojiURL);
    return downloadEmoji(realURL);
  }
  const defaultEmoji = emojiData.getImageData(name);
  if (defaultEmoji != null) {
    const url = `https://raw.githubusercontent.com/iamcal/emoji-data/master/img-apple-64/${defaultEmoji.imageUrl}`;
    return downloadEmoji(url);
  }
  return null;
};

const uploadImage = async (image: Buffer): Promise<string> => {
  const response = await new Promise((resolve, reject) => {
    // @ts-ignore it seems that cloudinary type definitions are not accurate
    cloudinary.uploader.upload_stream((error: any, data: any) => {
      if (error) {
        reject(error);
      }
      else {
        resolve(data);
      }
    }).end(image);
  });
  // @ts-ignore
  return response.secure_url;
};

const quantizeColor = async (frame: GifFrame): Promise<GifFrame> => {
  const {usesTransparency, indexCount} = frame.getPalette();
  if (indexCount <= 256) {
    return frame;
  }
  const maxColors = usesTransparency ? 255 : 256;
  const pointContainer = utils.PointContainer.fromBuffer(
    frame.bitmap.data,
    frame.bitmap.height,
    frame.bitmap.width
  );
  const palette = await buildPalette([pointContainer], {colors: maxColors});
  const processed = await applyPalette(pointContainer, palette);
  frame.bitmap.data = Buffer.from(processed.toUint8Array());
  return frame;
};

const uploadEmoji = async (emoji: Emoji): Promise<string> => {
  if (emoji.kind === 'static') {
    return uploadImage(emoji.image);
  }

  const quantizedFrames = new Array(emoji.frames.length);
  for (const i of quantizedFrames.keys()) {
    quantizedFrames[i] = await quantizeColor(emoji.frames[i]);
  }
  const codec = new GifCodec();
  const gif = await codec.encodeGif(quantizedFrames, emoji.options);
  return uploadImage(gif.buffer);
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
  if (emoji.kind === 'static') {
    return {
      kind: 'static',
      image: await frameOp(emoji.image),
    };
  }
  return {
    kind: 'gif',
    frames: await Promise.all(emoji.frames.map(async (frame) => {
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
};

const simpleFilter = (f: (frame: Buffer) => Promise<Buffer>): Filter => ({
  arguments: [],
  filter: (emoji: Emoji) => framewise(emoji, f),
});

const runtimeError = errorOfKind('RuntimeError');

const stringSVG = async (str: string, fontName: string, x: number, y: number, fontSize: number, options?: string): Promise<string> => {
  const opts = options === undefined ? '' : options;
  const font = await loadFont(fontName);
  const svg = font.getPath(str, x, y, fontSize).toSVG(2);
  return svg.replace('<path', `<path ${opts} `);
};

const proTwitter = async (emoji: Emoji, [name, account]: [string, string]): Promise<Emoji | EmodiError> => {
  const now = new Date();
  const apm = now.getHours() < 12 ? 'am' : 'pm';
  const hour = now.getHours() <= 12 ? now.getHours() : now.getHours() - 12;
  const fillZero = (n: number): string => n < 10 ? '0' + n.toString() : n.toString();
  const time = `${fillZero(hour)}:${fillZero(now.getMinutes())}${apm}`;
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const date = `${now.getDate()} ${months[now.getMonth()]} ${now.getFullYear()}`;
  const processFrame = async (frame: Buffer, raw?: sharp.Raw) => {
    const textSVG = stripIndent`
      <svg xmlns="http://www.w3.org/2000/svg" width="128" height="128">
        <rect width="100%" height = "100%" fill="white"/>
        ${await stringSVG('私がプロだ', 'Noto Sans JP Regular', 4, 80, 23)}
        ${await stringSVG(name, 'Noto Sans JP Regular', 35, 34, 19)}
        ${await stringSVG('@' + account, 'Noto Sans JP Regular', 35, 52, 16, 'fill="#9EABB6"')}
        ${await stringSVG(time, 'Noto Sans JP Regular', 8, 106, 16, 'fill="#9EABB6"')}
        ${await stringSVG(date, 'Noto Sans JP Regular', 32, 126, 16, 'fill="#9EABB6"')}
      </svg>`;
    const maxHeight = 52;
    const maxWidth = 35;
    const rawOption = raw == null ? {} : {raw};
    const icon = await sharp(frame, rawOption)
      .resize(maxWidth, maxHeight, {fit: 'inside'})
      .png()
      .toBuffer();
    const {width, height} = await sharp(icon).metadata();
    return sharp(Buffer.from(textSVG))
      .composite([{
        input: icon,
        top: maxHeight - height,
        left: maxWidth - width,
      }]);
  };
  if (emoji.kind === 'static') {
    const image = await processFrame(emoji.image);
    return {
      kind: 'static',
      image: await image.png().toBuffer(),
    };
  }

  const frames = await Promise.all(emoji.frames.map(async (frame) => {
    const options: sharp.Raw = {
      width: frame.bitmap.width,
      height: frame.bitmap.height,
      channels: 4,
    };
    const newFrame = await processFrame(frame.bitmap.data, options);
    const buffer = await newFrame.raw().toBuffer();
    return new GifFrame(128, 128, buffer, frame);
  }));
  return {
    kind: 'gif',
    frames,
    options: emoji.options,
  };
};

const toSquare = async (image: Buffer): Promise<Buffer> => {
  const {width, height} = await sharp(image).metadata();
  const extension = {top: 0, bottom: 0, left: 0, right: 0, background: {r: 0, b: 0, g: 0, alpha: 0}};
  if (width > height) {
    const top = Math.floor((width - height) / 2);
    extension.top = top;
    extension.bottom = width - height - top;
  }
  else {
    const left = Math.floor((height - width) / 2);
    extension.left = left;
    extension.right = height - width - left;
  }
  return sharp(image).extend(extension).toBuffer();
};


const moveFromTo = async (emoji: Emoji, [from, to]: [string, string]): Promise<Emoji | EmodiError> => {
  if (emoji.kind === 'gif') {
    return runtimeError('move accepts only static emoji');
  }
  type position = 'top' | 'bottom' | 'left' | 'right';
  const positions: position[] = ['top', 'bottom', 'left', 'right'];
  const isPosition = (s: string): s is position => (positions as string[]).includes(s);
  if (!isPosition(from) || !isPosition(to)) {
    return runtimeError('move: expected direction (top | bottom | left | right)');
  }
  const {width, height} = await sharp(emoji.image).metadata();
  const side = Math.max(width, height);
  const resized = await sharp(await toSquare(emoji.image)).png().toBuffer();
  const shift = async (pos: position, img: Buffer, frame: number): Promise<Buffer> => {
    const step = Math.round(frame * side / 12);
    const opposites = new Map<position, position>([
      ['top', 'bottom'], ['bottom', 'top'], ['left', 'right'], ['right', 'left'],
    ]);
    const opposite = opposites.get(pos);
    const extend = Object.fromEntries([
      ['background', {r: 0, g: 0, b: 0, alpha: 0}],
      ...positions.map((edge) => [edge, edge === opposite ? step : 0]),
    ]);
    const extract = {
      top: pos === 'top' ? step : 0,
      left: pos === 'left' ? step : 0,
      width: side,
      height: side,
    };
    const extended = await sharp(img).extend(extend).toBuffer();
    return sharp(extended).extract(extract).toBuffer();
  };
  const frames = await Promise.all(_.range(12).map(async (i) => {
    const [coming, going] = await Promise.all([
      shift(from, resized, 12 - i),
      shift(to, resized, i),
    ]);
    return sharp(going).composite([{input: coming}]).raw().toBuffer();
  }));
  return {
    kind: 'gif',
    frames: frames.map((buffer) => new GifFrame(side, side, buffer, {delayCentisecs: 6})),
    options: {loops: 0},
  };
};


const filters: Map<string, Filter> = new Map([
  ['identity', simpleFilter(_.identity)],
  ['speedTimes', {
    arguments: ['number'],
    filter: (emoji: Emoji, [ratio]: [number]) => {
      if (emoji.kind === 'static') {
        return emoji;
      }
      return {
        ...emoji,
        frames: emoji.frames.map((frame) => {
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
    filter: moveFromTo,
  }],
  ['go', {
    arguments: ['string'],
    filter: (emoji: Emoji, [direction]: [string]): Promise<Emoji | EmodiError> => {
      const opposite = new Map([
        ['top', 'bottom'], ['bottom', 'top'], ['left', 'right'], ['right', 'left'],
      ]);
      const from = opposite.get(direction);
      if (from == null) {
        return Promise.resolve(
          runtimeError('go: expected direction (top | bottom | left | right)')
        );
      }
      return moveFromTo(emoji, [from, direction]);
    },
  }],
  ['trim', {
    arguments: ['number'],
    filter: (emoji: Emoji, [threshold]: [number]): Promise<Emoji | EmodiError> =>
      framewise(
        emoji,
        (image: Buffer, raw?: sharp.Raw): Promise<Buffer> => {
          const options = raw == null ? {} : {raw};
          return sharp(image, options).trim(threshold).toBuffer();
        }
      ),
  }],
  ['distort',
    simpleFilter(async (image: Buffer, raw?: sharp.Raw): Promise<Buffer> => {
      const options = raw == null ? {} : {raw};
      const resized = await toSquare(await sharp(image, options).png().toBuffer());
      const {width: side} = await sharp(resized).metadata();
      const rows: Buffer[] = Array(side);
      for (const i of Array(side).keys()) {
        const row = await sharp(resized)
          .extract({left: 0, top: i, width: side, height: 1})
          .toBuffer();
        if (i === 0) {
          rows[i] = row;
          continue;
        }
        rows[i] = await sharp(row)
          .extract({left: i, top: 0, width: side - i, height: 1})
          .extend({top: 0, left: 0, right: i, bottom: 0, background: 'transparent'})
          .composite([{
            input: await sharp(row).extract({left: 0, top: 0, width: i, height: 1}).toBuffer(),
            gravity: 'east',
          }])
          .toBuffer();
      }
      const composed = sharp({
        create: {
          width: side,
          height: side,
          channels: 4,
          background: 'transparent',
        },
      }).composite(rows.map((row, i) => ({
        input: row,
        top: i,
        left: 0,
      })));
      return (raw == null ? composed.png().toBuffer() : composed.raw().toBuffer());
    }),
  ],
  ['pro', {
    arguments: ['string', 'string'],
    filter: proTwitter,
  }],
  ['think',
    simpleFilter(async (image: Buffer, raw?: sharp.Raw): Promise<Buffer> => {
      const options = raw == null ? {} : {raw};
      const resized = await toSquare(await sharp(image, options).png().toBuffer());
      const {width: side} = await sharp(resized).metadata();
      const hand = await sharp('emoji-modifier/resources/thinking-hand.png')
        .resize(side)
        .toBuffer();
      const composed = sharp(resized).composite([{input: hand}]);
      return (raw == null ? composed.png().toBuffer() : composed.raw().toBuffer());
    }),
  ],
] as [string, Filter][]);
// }}}

// help document {{{
const helpDocs: Map<string, string> = new Map([
  [
    '',
    'usage: <emoji> | <filter> <argument> <argument> ... | <filter> <argument> <argument> ... | ...\n'
      + 'Write ":" around the emoji name!'
  ],
  ['help', 'usage: help <filter>\nGet information about the given filter.'],
  // filters
  ['identity', 'usage: identity (no argument)\nMake no change.'],
  ['speedTimes', 'usage: speedtimes <number>\nChange the speed of animation.'],
  ['mirrorV', 'usage: mirrorV (no argument)\nReflect the emoji through the horizontal median line.'],
  ['mirror', 'usage: mirror (no argument)\nReflect the emoji through the vertical median line.'],
  [
    'move',
    'usage: move <"top"|"bottom"|"left"|"right"> <"top"|"bottom"|"left"|"right">\n'
      + 'Move the emoji so that it comes in from the side specified by the first argument and goes out through the side specified by the second argument.'
  ],
  ['go', 'usage: move <"top"|"bottom"|"left"|"right">\nMove the emoji in the given direction.'],
  ['trim', 'usage: trim <number>\nTrim the emoji including the opaque pixels with regard to the given threshold.'],
  ['distort', 'usage: distort (no argument)\nDistort the emoji.'],
  ['pro', 'usage: pro <string> <string>\nCreate a fake proof that somebody of the emoji avatar with the given username and user_id said "私がプロだ" on an SNS.'],
  ['think', 'usage: think (no argument)\nAttach a hand to the emoji as if it is thinking.'],
]);
// }}}

// parsing & executing {{{
interface Transformation {
  kind: 'success';
  emojiName: string;
  filters: [string, string[]][];
}

interface HelpRequest {
  kind: 'help';
  argument: string
}

type ParseResult = Transformation | EmodiError | HelpRequest;
// TODO: allow string arguments to contain spaces
const parse = (message: string): ParseResult => {
  const parseError = errorOfKind('ParseError');
  const parts = message.split('|').map(_.trim);
  logger.info(parts);
  if (parts.length < 1) {
    return parseError('Expected emoji; you can also type "@emodi help"');
  }
  if (parts[0] === 'help') {
    if (parts.length === 1) {
      return {kind: 'help', argument: ''};
    }
    if (parts.length === 2) {
      return {kind: 'help', argument: parts[1]};
    }
    return parseError('too many argument');
  }
  const nameMatch = /^:(?<name>[^!:\s]+):$/.exec(parts[0]);
  if (nameMatch == null) {
    return parseError(`\`${parts[0]}\` is not a valid emoji name`);
  }
  let error: EmodiError = null;
  const appliedFilters: [string, string[]][] = parts.slice(1).map((part) => {
    const tokens = part.split(/\s/).filter((s) => s !== '');
    if (tokens.length < 1) {
      error = parseError('Empty filter');
      return undefined;
    }
    return [tokens[0], tokens.slice(1)];
  });
  if (error != null) {
    return error;
  }
  return {
    kind: 'success',
    emojiName: nameMatch.groups.name,
    filters: appliedFilters,
  };
};

const runTransformation = async (parseResult: Transformation): Promise<Emoji | EmodiError> => {
  const nameError = errorOfKind('NameError');
  const emoji = await lookupEmoji(parseResult.emojiName);
  if (emoji == null) {
    return nameError(`\`:${parseResult.emojiName}:\` : No such emoji`);
  }
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
      if (type === 'string' || !isNaN(_.toNumber(arg))) {
        return null;
      }
      return typeError(`\`${arg}\` is not a number`);
    }).reduce((a, b) => a || b, null);
    if (typeMismatch != null) {
      error = typeMismatch;
      return null;
    }
    const convertedArgs = _.zipWith(args, argTypes, (arg, type) => {
      if (type === 'string') {
        return arg;
      }
      return _.toNumber(arg);
    });
    return (target: Emoji) => filter.filter(target, convertedArgs);
  });
  if (error != null) {
    return error;
  }
  return filterFuns.reduce(
    async (previous, func) => {
      const emojiImage = await previous;
      if (emojiImage.kind === 'error') {
        return emojiImage;
      }
      return func(emojiImage);
    },
    Promise.resolve(emoji as Emoji | EmodiError)
  );
};

const buildResponse = async (message: string): Promise<Emoji | EmodiError | HelpRequest> => {
  const parseResult = parse(message);
  if (parseResult.kind === 'error' || parseResult.kind === 'help') {
    return parseResult;
  }
  const result = await runTransformation(parseResult);
  return result;
};

// }}}

// user interaction {{{

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
  };
  const postHelp = (): void => {
    slack.chat.postMessage({
      channel: process.env.CHANNEL_SANDBOX,
      username: 'emoji-modifier',
      icon_emoji: ':essential-information:',
      text: [...filters.entries()].map(([name, filter]: [string, Filter]): string => {
        if (filter.arguments.length === 0) {
          return name;
        }
        return name + ' ' + filter.arguments.map((s: string) => '[' + s + ']').join(' ');
      }).join('\n'),
    });
  };

  rtm.on('message', async (message) => {
    if (message.channel !== process.env.CHANNEL_SANDBOX ||
      message.subtype === 'bot_message') {
      return;
    }

    const operation = /^@emodi\s(?<command>(?:.|\n)*)$/.exec(message.text);
    if (operation == null) {
      return;
    }

    const internalError = errorOfKind('InternalError');
    const result = await buildResponse(operation.groups.command)
      .catch((err) => {
        logger.error(err.message);
        return internalError(err.name + ': ' + err.message + '\n Please inform :coil:.');
      });
    if (result.kind === 'error') {
      postError(result.message);
    }
    else if (result.kind === 'help') {
      postHelp();
    }
    else {
      const url = await uploadEmoji(result);
      postImage(url);
    }
  });
};
// }}}
