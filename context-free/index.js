"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.server = void 0;
const axios_1 = __importDefault(require("axios"));
const fastify_plugin_1 = __importDefault(require("fastify-plugin"));
const lodash_1 = require("lodash");
const scrape_it_1 = __importDefault(require("scrape-it"));
// @ts-expect-error
const getReading_1 = __importDefault(require("../lib/getReading"));
const slackUtils_1 = require("../lib/slackUtils");
// @ts-expect-error
const bot_1 = __importDefault(require("../tahoiya/bot"));
const cfp_tags_1 = require("./cfp-tags");
const normalizeMeaning = (input) => {
    let meaning = input;
    meaning = meaning.replace(/&nbsp;/g, ' ');
    meaning = meaning.replace(/<(?:".*?"|'.*?'|[^'"])*?>/g, '');
    meaning = meaning.replace(/\s*\[.+?\]\s*/g, '');
    meaning = meaning.replace(/（/g, '(');
    meaning = meaning.replace(/）/g, ')');
    meaning = meaning.replace(/\s*\(.+?\)\s*/g, '');
    meaning = meaning.replace(/（.+?）/g, '');
    meaning = meaning.replace(/【.+?】/g, '');
    if (meaning.includes('とは、')) {
        meaning = meaning.replace(/^.*?とは、/, '');
    }
    else if (meaning.includes('とは，')) {
        meaning = meaning.replace(/^.*?とは，/, '');
    }
    else if (meaning.includes('は、')) {
        meaning = meaning.replace(/^.*?は、/, '');
    }
    else if (meaning.includes('とは')) {
        meaning = meaning.replace(/^.*?とは/, '');
    }
    meaning = meaning.replace(/であり、.+$/, '');
    meaning = meaning.replace(/であるが、.+$/, '');
    meaning = meaning.replace(/のこと(?!わざ).+$/, '');
    meaning = meaning.replace(/を指す.+$/, '');
    meaning = meaning.replace(/^== (?<content>.+?) ==$/g, '$<content>');
    meaning = meaning.replace(/。[^」』].*$/, '');
    meaning = meaning.replace(/^\*/, '');
    meaning = meaning.replace(/^[\d０-９][.．\s]/, '');
    meaning = meaning.trim().replace(/(?:のこと|の事|をいう|である|です|を指す|とされ(?:る|ます)|とされてい(?:る|ます)|、|。)+$/, '');
    meaning = meaning.replace(/(?:の一つ|のひとつ|の１つ)$/, 'の1つ');
    meaning = meaning.replace(/(?:の1人|のひとり|の１人)$/, 'の一人');
    meaning = meaning.replace(/(?:の1種|の１種)$/, 'の一種');
    return meaning.trim();
};
const extractMeaning = (description) => {
    const match = description.match(/^.+?(?:とは\?(?<reference>.+?)。|の意味は)(?<meaning>.+)$/);
    if (match === null) {
        return 'わからん';
    }
    const { groups: { reference, meaning } } = match;
    if (reference && reference.endsWith('用語')) {
        return `${reference}。${normalizeMeaning(meaning)}。`;
    }
    return `${normalizeMeaning(meaning)}。`;
};
const randomWord = async () => {
    const response = await (0, scrape_it_1.default)('https://www.weblio.jp/WeblioRandomSelectServlet', {
        word: {
            selector: 'h2.midashigo',
            attr: 'title',
        },
        description: {
            selector: 'meta[name=description]',
            attr: 'content',
        },
    });
    const date = new Date().toLocaleString('en-US', {
        timeZone: 'Asia/Tokyo',
        month: 'numeric',
        day: 'numeric',
    });
    if (date === '4/1') {
        const reading = await (0, getReading_1.default)(response.data.word);
        const result = await bot_1.default.getResult(reading, 'tahoiyabot-02');
        return {
            word: response.data.word,
            description: result.result,
        };
    }
    const description = extractMeaning(response.data.description);
    return {
        word: response.data.word,
        description,
    };
};
const sleepFor = (duration) => new Promise((resolve) => {
    setTimeout(resolve, duration);
});
const composePost = async (message) => {
    if (message === '') {
        const { word } = await randomWord();
        return word;
    }
    let response = message;
    for (const match of response.matchAll(/{<(?<phTag>[^{}<>]*)>[^{}<>]*}/g)) {
        if (!cfp_tags_1.tags.has(match.groups.phTag)) {
            throw new Error(`/cfp tag '${match.groups.phTag}' not found. (Perhaps you can implement it?)`);
        }
    }
    let first = true;
    let match = null;
    let replacementCount = 0;
    while ((match = /(?<placeholder>{(?:<(?<phTag>[^{}<>]*)>)?(?<phName>[^{}<>]*)})/.exec(response)) != null) {
        const { placeholder, phTag, phName } = match.groups;
        if (phTag === undefined) {
            if (first) {
                first = false;
            }
            else {
                await sleepFor(5000);
            }
        }
        const word = (phTag === undefined ? (await randomWord()).word : cfp_tags_1.tags.get(phTag)());
        if (phName === '') {
            response = response.replace(placeholder, word);
        }
        else {
            response = response.replace(new RegExp((0, lodash_1.escapeRegExp)(placeholder), 'g'), word);
        }
        replacementCount++;
    }
    if (replacementCount === 0) {
        throw new Error('No placeholders found in the message.');
    }
    return response;
};
const randomInterval = () => 1000 * 60 * (60 * 15 + (Math.random() - 0.5) * 2 * 60);
const server = ({ eventClient, webClient: slack }) => (0, fastify_plugin_1.default)(async (fastify) => {
    const postWord = async () => {
        const { word, description } = await randomWord();
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
    /* eslint-disable require-await */
    eventClient.on('message', async (message) => {
        if (message.channel !== process.env.CHANNEL_SANDBOX ||
            message.subtype === 'bot_message') {
            return;
        }
        if (/^\s*@cfb(?:\s.*)?$/.exec(message.text) != null) {
            postWord();
        }
    });
    setTimeout(repeatPost, randomInterval());
    const { team: tsgTeam } = await slack.team.info();
    fastify.post('/slash/context-free-post', async (request, response) => {
        if (request.body.token !== process.env.SLACK_VERIFICATION_TOKEN) {
            response.code(400);
            return 'Bad Request';
        }
        if (request.body.team_id !== tsgTeam.id) {
            response.code(200);
            return '/cfp is only for TSG. Sorry!';
        }
        const username = await (0, slackUtils_1.getMemberName)(request.body.user_id);
        const icon_url = await (0, slackUtils_1.getMemberIcon)(request.body.user_id, 512);
        composePost(request.body.text)
            .then((text) => {
            slack.chat.postMessage({
                username,
                icon_url,
                channel: request.body.channel_id,
                text,
            });
        })
            .catch((error) => {
            axios_1.default.post(request.body.response_url, { text: error.message });
        });
        return '';
    });
});
exports.server = server;
