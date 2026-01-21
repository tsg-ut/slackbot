"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const axios_1 = __importDefault(require("axios"));
const cloudinary_1 = require("cloudinary");
const common_tags_1 = require("common-tags");
const emoji_data_ts_1 = require("emoji-data-ts");
/* eslint-disable no-unused-vars */
const gifwrap_1 = require("gifwrap");
const image_q_1 = require("image-q");
const lodash_1 = __importDefault(require("lodash"));
const sharp_1 = __importDefault(require("sharp"));
const loadFont_1 = __importDefault(require("../lib/loadFont"));
const logger_1 = __importDefault(require("../lib/logger"));
const slackUtils_1 = require("../lib/slackUtils");
const log = logger_1.default.child({ bot: 'emoji-modifier' });
const errorOfKind = (kind) => (message) => ({
    kind: 'error',
    message: kind + ': ' + message + ':cry:',
});
// }}}
// emoji download/upload {{{
const downloadEmoji = async (url) => {
    const response = await axios_1.default.get(url, { responseType: 'arraybuffer' });
    const data = Buffer.from(response.data);
    if (response.headers['content-type'] === 'image/gif') {
        const codec = new gifwrap_1.GifCodec();
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
const emojiData = new emoji_data_ts_1.EmojiData();
let team_id = null;
const trailAlias = (name) => {
    const match = /alias:(?<genuineName>.+)/.exec(name);
    return match == null ? Promise.resolve(name) : (0, slackUtils_1.getEmoji)(match.groups.genuineName, team_id);
};
const lookupEmoji = async (name) => {
    const emojiURL = await (0, slackUtils_1.getEmoji)(name, team_id);
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
const uploadImage = async (image) => {
    const response = await new Promise((resolve, reject) => {
        cloudinary_1.v2.uploader.upload_stream((error, data) => {
            if (error) {
                reject(error);
            }
            else {
                resolve(data);
            }
        }).end(image);
    });
    // @ts-expect-error
    return response.secure_url;
};
const quantizeColor = async (frame) => {
    const { usesTransparency, indexCount } = frame.getPalette();
    if (indexCount <= 256) {
        return frame;
    }
    const maxColors = usesTransparency ? 255 : 256;
    const pointContainer = image_q_1.utils.PointContainer.fromBuffer(frame.bitmap.data, frame.bitmap.height, frame.bitmap.width);
    const palette = await (0, image_q_1.buildPalette)([pointContainer], { colors: maxColors });
    const processed = await (0, image_q_1.applyPalette)(pointContainer, palette);
    frame.bitmap.data = Buffer.from(processed.toUint8Array());
    return frame;
};
const uploadEmoji = async (emoji) => {
    if (emoji.kind === 'static') {
        return uploadImage(emoji.image);
    }
    const quantizedFrames = new Array(emoji.frames.length);
    for (const i of quantizedFrames.keys()) {
        quantizedFrames[i] = await quantizeColor(emoji.frames[i]);
    }
    const codec = new gifwrap_1.GifCodec();
    const gif = await codec.encodeGif(quantizedFrames, emoji.options);
    return uploadImage(gif.buffer);
};
const framewise = async (emoji, frameOp) => {
    if (emoji.kind === 'static') {
        return {
            kind: 'static',
            image: await frameOp(emoji.image),
        };
    }
    return {
        kind: 'gif',
        frames: await Promise.all(emoji.frames.map(async (frame) => {
            const options = {
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
const simpleFilter = (f) => ({
    arguments: [],
    filter: (emoji) => framewise(emoji, f),
});
const runtimeError = errorOfKind('RuntimeError');
const stringSVG = async (str, fontName, x, y, fontSize, options) => {
    const opts = options === undefined ? '' : options;
    const font = await (0, loadFont_1.default)(fontName);
    const svg = font.getPath(str, x, y, fontSize).toSVG(2);
    return svg.replace('<path', `<path ${opts} `);
};
const proTwitter = async (emoji, [name, account]) => {
    const now = new Date();
    const apm = now.getHours() < 12 ? 'am' : 'pm';
    const hour = now.getHours() <= 12 ? now.getHours() : now.getHours() - 12;
    const fillZero = (n) => n < 10 ? '0' + n.toString() : n.toString();
    const time = `${fillZero(hour)}:${fillZero(now.getMinutes())}${apm}`;
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const date = `${now.getDate()} ${months[now.getMonth()]} ${now.getFullYear()}`;
    const processFrame = async (frame, raw) => {
        const textSVG = (0, common_tags_1.stripIndent) `
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
        const rawOption = raw == null ? {} : { raw };
        const icon = await (0, sharp_1.default)(frame, rawOption)
            .resize(maxWidth, maxHeight, { fit: 'inside' })
            .png()
            .toBuffer();
        const { width, height } = await (0, sharp_1.default)(icon).metadata();
        return (0, sharp_1.default)(Buffer.from(textSVG))
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
        const options = {
            width: frame.bitmap.width,
            height: frame.bitmap.height,
            channels: 4,
        };
        const newFrame = await processFrame(frame.bitmap.data, options);
        const buffer = await newFrame.raw().toBuffer();
        return new gifwrap_1.GifFrame(128, 128, buffer, frame);
    }));
    return {
        kind: 'gif',
        frames,
        options: emoji.options,
    };
};
const toSquare = async (image) => {
    const { width, height } = await (0, sharp_1.default)(image).metadata();
    const extension = { top: 0, bottom: 0, left: 0, right: 0, background: { r: 0, b: 0, g: 0, alpha: 0 } };
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
    return (0, sharp_1.default)(image).extend(extension).toBuffer();
};
const moveFromTo = async (emoji, [from, to]) => {
    if (emoji.kind === 'gif') {
        return runtimeError('move accepts only static emoji');
    }
    const positions = ['top', 'bottom', 'left', 'right'];
    const isPosition = (s) => positions.includes(s);
    if (!isPosition(from) || !isPosition(to)) {
        return runtimeError('move: expected direction (top | bottom | left | right)');
    }
    const { width, height } = await (0, sharp_1.default)(emoji.image).metadata();
    const side = Math.max(width, height);
    const resized = await (0, sharp_1.default)(await toSquare(emoji.image)).png().toBuffer();
    const shift = async (pos, img, frame) => {
        const step = Math.round(frame * side / 12);
        const opposites = new Map([
            ['top', 'bottom'], ['bottom', 'top'], ['left', 'right'], ['right', 'left'],
        ]);
        const opposite = opposites.get(pos);
        const extend = Object.fromEntries([
            ['background', { r: 0, g: 0, b: 0, alpha: 0 }],
            ...positions.map((edge) => [edge, edge === opposite ? step : 0]),
        ]);
        const extract = {
            top: pos === 'top' ? step : 0,
            left: pos === 'left' ? step : 0,
            width: side,
            height: side,
        };
        const extended = await (0, sharp_1.default)(img).extend(extend).toBuffer();
        return (0, sharp_1.default)(extended).extract(extract).toBuffer();
    };
    const frames = await Promise.all(lodash_1.default.range(12).map(async (i) => {
        const [coming, going] = await Promise.all([
            shift(from, resized, 12 - i),
            shift(to, resized, i),
        ]);
        return (0, sharp_1.default)(going).composite([{ input: coming }]).raw().toBuffer();
    }));
    return {
        kind: 'gif',
        frames: frames.map((buffer) => new gifwrap_1.GifFrame(side, side, buffer, { delayCentisecs: 6 })),
        options: { loops: 0 },
    };
};
const filters = new Map([
    ['identity', simpleFilter(lodash_1.default.identity)],
    ['speedTimes', {
            arguments: ['number'],
            filter: (emoji, [ratio]) => {
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
    ['mirrorV', simpleFilter((image, raw) => {
            const options = raw == null ? {} : { raw };
            return (0, sharp_1.default)(image, options).flip().toBuffer();
        })],
    ['mirror', simpleFilter((image, raw) => {
            const options = raw == null ? {} : { raw };
            return (0, sharp_1.default)(image, options).flop().toBuffer();
        })],
    ['move', {
            arguments: ['string', 'string'],
            filter: moveFromTo,
        }],
    ['go', {
            arguments: ['string'],
            filter: (emoji, [direction]) => {
                const opposite = new Map([
                    ['top', 'bottom'], ['bottom', 'top'], ['left', 'right'], ['right', 'left'],
                ]);
                const from = opposite.get(direction);
                if (from == null) {
                    return Promise.resolve(runtimeError('go: expected direction (top | bottom | left | right)'));
                }
                return moveFromTo(emoji, [from, direction]);
            },
        }],
    ['trim', {
            arguments: ['number'],
            filter: (emoji, [threshold]) => framewise(emoji, (image, raw) => {
                const options = raw == null ? {} : { raw };
                return (0, sharp_1.default)(image, options).trim(threshold).toBuffer();
            }),
        }],
    ['distort',
        simpleFilter(async (image, raw) => {
            const options = raw == null ? {} : { raw };
            const resized = await toSquare(await (0, sharp_1.default)(image, options).png().toBuffer());
            const { width: side } = await (0, sharp_1.default)(resized).metadata();
            const rows = Array(side);
            for (const i of Array(side).keys()) {
                const row = await (0, sharp_1.default)(resized)
                    .extract({ left: 0, top: i, width: side, height: 1 })
                    .toBuffer();
                if (i === 0) {
                    rows[i] = row;
                    continue;
                }
                rows[i] = await (0, sharp_1.default)(row)
                    .extract({ left: i, top: 0, width: side - i, height: 1 })
                    .extend({ top: 0, left: 0, right: i, bottom: 0, background: 'transparent' })
                    .composite([{
                        input: await (0, sharp_1.default)(row).extract({ left: 0, top: 0, width: i, height: 1 }).toBuffer(),
                        gravity: 'east',
                    }])
                    .toBuffer();
            }
            const composed = (0, sharp_1.default)({
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
        simpleFilter(async (image, raw) => {
            const options = raw == null ? {} : { raw };
            const resized = await toSquare(await (0, sharp_1.default)(image, options).png().toBuffer());
            const { width: side } = await (0, sharp_1.default)(resized).metadata();
            const hand = await (0, sharp_1.default)('emoji-modifier/resources/thinking-hand.png')
                .resize(side)
                .toBuffer();
            const composed = (0, sharp_1.default)(resized).composite([{ input: hand }]);
            return (raw == null ? composed.png().toBuffer() : composed.raw().toBuffer());
        }),
    ],
]);
// }}}
// help document {{{
const helpDocs = new Map([
    ['help', 'usage: help <filter>\nGet information about the given filter.'],
    // filters
    ['identity', 'usage: identity (no argument)\nMake no change.'],
    ['speedTimes', 'usage: speedtimes <number>\nChange the speed of animation.'],
    ['mirrorV', 'usage: mirrorV (no argument)\nReflect the emoji through the horizontal median line.'],
    ['mirror', 'usage: mirror (no argument)\nReflect the emoji through the vertical median line.'],
    [
        'move',
        'usage: move <"top"|"bottom"|"left"|"right"> <"top"|"bottom"|"left"|"right">\n' +
            'Move the emoji so that it comes in from the side specified by the first argument and goes out through the side specified by the second argument.',
    ],
    ['go', 'usage: move <"top"|"bottom"|"left"|"right">\nMove the emoji in the given direction.'],
    ['trim', 'usage: trim <number>\nTrim the emoji including the opaque pixels with regard to the given threshold.'],
    ['distort', 'usage: distort (no argument)\nDistort the emoji.'],
    ['pro', 'usage: pro <string> <string>\nCreate a fake proof that somebody of the emoji avatar with the given username and user_id said "私がプロだ" on an SNS.'],
    ['think', 'usage: think (no argument)\nAttach a hand to the emoji as if it is thinking.'],
]);
// TODO: allow string arguments to contain spaces
const parse = (message) => {
    const parseError = errorOfKind('ParseError');
    const parts = message.split('|').map(lodash_1.default.trim);
    log.info(parts);
    if (parts.length < 1) {
        return parseError('Expected emoji; you can also type `@emodi help`');
    }
    if (parts[0] === 'help' || parts[0].startsWith('help ')) {
        if (parts.length > 1) {
            return parseError('filters cannot be applied to `help`');
        }
        const subparts = parts[0].split(/\s+/); // split by series of spaces
        if (subparts.length === 1) {
            return {
                kind: 'help',
                document: 'usage: @emodi <emoji> | <filter> <argument> <argument> ... | <filter> <argument> <argument> ... | ...\n' +
                    'Write ":" around the emoji name!\n\n' +
                    'Filters: ' +
                    [...filters.keys()].join(' '),
            };
        }
        if (subparts.length === 2) {
            const document = helpDocs.get(subparts[1]);
            if (document === undefined) {
                const helpArgumentError = errorOfKind('HelpArgumentError');
                return helpArgumentError('No such filter, or no document for it');
            }
            return { kind: 'help', document };
        }
        return parseError('too many argument');
    }
    const nameMatch = /^:(?<name>[^!:\s]+):$/.exec(parts[0]);
    if (nameMatch == null) {
        return parseError(`\`${parts[0]}\` is not a valid emoji name`);
    }
    let error = null;
    const appliedFilters = parts.slice(1).map((part) => {
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
const runTransformation = async (parseResult) => {
    const nameError = errorOfKind('NameError');
    const emoji = await lookupEmoji(parseResult.emojiName);
    if (emoji == null) {
        return nameError(`\`:${parseResult.emojiName}:\` : No such emoji`);
    }
    const typeError = errorOfKind('TypeError');
    let error = null;
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
        const typeMismatch = lodash_1.default.zipWith(args, argTypes, (arg, type) => {
            if (type === 'string' || !isNaN(lodash_1.default.toNumber(arg))) {
                return null;
            }
            return typeError(`\`${arg}\` is not a number`);
        }).reduce((a, b) => a || b, null);
        if (typeMismatch != null) {
            error = typeMismatch;
            return null;
        }
        const convertedArgs = lodash_1.default.zipWith(args, argTypes, (arg, type) => {
            if (type === 'string') {
                return arg;
            }
            return lodash_1.default.toNumber(arg);
        });
        return (target) => filter.filter(target, convertedArgs);
    });
    if (error != null) {
        return error;
    }
    return filterFuns.reduce(async (previous, func) => {
        const emojiImage = await previous;
        if (emojiImage.kind === 'error') {
            return emojiImage;
        }
        return func(emojiImage);
    }, Promise.resolve(emoji));
};
const buildResponse = async (message) => {
    const parseResult = parse(message);
    if (parseResult.kind === 'error' || parseResult.kind === 'help') {
        return parseResult;
    }
    const result = await runTransformation(parseResult);
    return result;
};
// }}}
// user interaction {{{
exports.default = async ({ eventClient, webClient: slack }) => {
    const { team } = await slack.team.info();
    team_id = team.id;
    const postImage = (url) => {
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
    const postError = (message) => {
        slack.chat.postMessage({
            channel: process.env.CHANNEL_SANDBOX,
            username: 'emoji-modifier',
            icon_emoji: ':yokunasasou:',
            text: message,
        });
    };
    const postHelp = (document) => {
        slack.chat.postMessage({
            channel: process.env.CHANNEL_SANDBOX,
            username: 'emoji-modifier',
            icon_emoji: ':essential-information:',
            text: document,
        });
    };
    eventClient.on('message', async (message) => {
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
            log.error(err.message);
            return internalError(err.name + ': ' + err.message + '\n Please inform :coil:.');
        });
        if (result.kind === 'error') {
            postError(result.message);
        }
        else if (result.kind === 'help') {
            postHelp(result.document);
        }
        else {
            const url = await uploadEmoji(result);
            postImage(url);
        }
    });
};
// }}}
