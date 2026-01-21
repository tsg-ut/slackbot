"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.server = void 0;
const fs_1 = require("fs");
const path_1 = __importDefault(require("path"));
const fastify_plugin_1 = __importDefault(require("fastify-plugin"));
const lodash_1 = __importDefault(require("lodash"));
const logger_1 = __importDefault(require("../lib/logger"));
const slackUtils_1 = require("../lib/slackUtils");
const log = logger_1.default.child({ bot: 'emoxpand' });
const emojiFromContent = (content) => ({
    content,
    height: content.length,
    width: Math.max(...content.map((x) => x.length)),
});
const bigemojify = (smallEmoji) => emojiFromContent([[smallEmoji]]);
const logError = (err, mesg) => {
    log.error(`emoxpand: ${mesg} : ${err.name} ${err.message}`);
};
// Emoji saving {{{
const emojiData = 'bigemojis.json';
const emojiPath = path_1.default.resolve(__dirname, emojiData);
let allEmojis = new Map();
const loadEmojis = async () => {
    allEmojis = new Map();
    const data = await fs_1.promises.readFile(emojiPath, { encoding: 'utf8' });
    const obj = JSON.parse(data);
    log.info('emoxpand: loading big emojis...');
    for (const [name, content] of Object.entries(obj)) {
        allEmojis.set(name, emojiFromContent(content));
    }
    return allEmojis;
};
loadEmojis();
const emojisToJson = (emojis) => {
    const obj = Object.fromEntries(Array.from(emojis, ([name, emoji]) => [name, emoji.content]));
    return JSON.stringify(obj);
};
const storeEmojis = (emojis) => {
    fs_1.promises.writeFile(emojiPath, emojisToJson(emojis));
};
const addEmoji = (name, emoji) => {
    allEmojis.set(name, emoji);
    storeEmojis(allEmojis);
};
// }}}
// expansion {{{
const alignEmojis = (es) => {
    if (es.length === 0) {
        return [''];
    }
    const wholeHeight = Math.max(...es.map((e) => e.height));
    const voids = (width) => Array(width).fill('_');
    const emojiBlocks = es
        .map(({ width, height, content }) => content
        .concat(Array(wholeHeight - height).fill(0).map((_) => []))
        .map((row) => row
        .concat(voids(width - row.length))
        .map((emoji) => `:${emoji}:`)
        .join('')));
    return lodash_1.default.zipWith(...emojiBlocks, (...rows) => rows.join(''));
};
const expandEmoji = (text) => {
    let replacementCount = 0;
    const result = lodash_1.default.flatMap(text.split('\n'), (line) => {
        const [, , tokens] = (line + '\n').split('').reduce(([parsing, chars, parsed], ch) => {
            const push = () => {
                if (chars.length === 0) {
                    return;
                }
                const content = chars.join('');
                if (parsing === 'BigEmoji' && !allEmojis.has(content)) {
                    parsed.push({
                        kind: 'Plain',
                        content: `!${content}!`,
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
                    if (parsing === 'Emoji') {
                        push();
                        return ['Plain', [], parsed];
                    }
                    break;
                case '!':
                    if (parsing === 'Plain') {
                        push();
                        return ['BigEmoji', [], parsed];
                    }
                    if (parsing === 'BigEmoji') {
                        push();
                        return ['Plain', [], parsed];
                    }
                    break;
                case '\n':
                    push();
                    return ['Plain', [], parsed];
                default:
                // do nothing
            }
            chars.push(ch);
            return [parsing, chars, parsed];
        }, ['Plain', [], []]);
        if (tokens.length > 0 && tokens[tokens.length - 1].kind !== 'Plain') {
            tokens.push({ kind: 'Plain', content: '' });
        }
        return tokens.reduce(([inLine, lines], tok) => {
            if (tok.kind === 'Plain') {
                if (inLine.length > 0) {
                    replacementCount += 1;
                    const emojiLines = alignEmojis(inLine.map(({ kind, content }) => (kind === 'Emoji' ? bigemojify(content) : allEmojis.get(content))));
                    emojiLines[0] += tok.content;
                    lines.push(emojiLines.join('\n'));
                    return [[], lines];
                }
                lines.push(tok.content);
                return [[], lines];
            }
            inLine.push(tok);
            return [inLine, lines];
        }, [[], []])[1];
    }).join('\n');
    if (replacementCount === 0) {
        throw new Error('No emojis found in the message.');
    }
    return result;
};
// }}}
const server = ({ eventClient, webClient: slack }) => (0, fastify_plugin_1.default)(async (fastify) => {
    const postMessage = (text) => {
        slack.chat.postMessage({
            channel: process.env.CHANNEL_SANDBOX,
            text,
            username: 'BigEmojier',
            icon_emoji: ':chian-ga-aru:',
        });
    };
    // Big Emoji expansion {{{
    const { team: tsgTeam } = await slack.team.info();
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
            username: await (0, slackUtils_1.getMemberName)(request.body.user_id),
            icon_url: await (0, slackUtils_1.getMemberIcon)(request.body.user_id, 192),
        });
        return '';
    });
    // }}}
    // Emoji list API {{{
    fastify.get('/emoxpand/list', (_, response) => {
        response.header('Content-Type', 'applicaton/json').code(200);
        return Promise.resolve(emojisToJson(allEmojis));
    });
    let state = 'WaitingRegistration';
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
                    state = { name: match.groups.name };
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
                        .map((row) => row.slice(1, row.length - 1).split('::'));
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
exports.server = server;
