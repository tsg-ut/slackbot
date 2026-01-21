"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// XXX: sharpをcanvasより先に読み込むとエラーになるため、ここで読み込んでおく
// https://github.com/Automattic/node-canvas/issues/930
require("canvas");
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config({ override: true });
const fastify_1 = __importDefault(require("fastify"));
const querystring_1 = __importDefault(require("querystring"));
const slack_1 = require("./lib/slack");
const yargs_1 = __importDefault(require("yargs"));
const logger_1 = __importDefault(require("./lib/logger"));
const express_1 = __importDefault(require("@fastify/express"));
const formbody_1 = __importDefault(require("@fastify/formbody"));
const sharp_1 = __importDefault(require("sharp"));
const lodash_1 = require("lodash");
const util_1 = require("util");
const concat_stream_1 = __importDefault(require("concat-stream"));
const slackUtils_1 = require("./lib/slackUtils");
const eventDeduplication_1 = require("./lib/eventDeduplication");
const log = logger_1.default.child({ bot: 'index' });
process.on('unhandledRejection', (error, promise) => {
    log.error(`unhandledRejection at: ${promise} reason: ${error.stack ?? error.message}`, { error, stack: error.stack, promise });
});
// Disable the cache since it likely hits the swap anyway
sharp_1.default.cache(false);
const fastify = (0, fastify_1.default)({
    logger: logger_1.default.child({ bot: 'http/index' }),
    pluginTimeout: 50000,
});
const gracefulShutdown = async (signal) => {
    log.info(`Received ${signal}, starting graceful shutdown...`);
    try {
        await fastify.close();
        log.info('Fastify server closed');
        await (0, eventDeduplication_1.closeDuplicateEventChecker)();
        log.info('Event deduplication checker closed');
        log.info('Graceful shutdown completed');
        process.exit(0);
    }
    catch (error) {
        log.error('Error during graceful shutdown', { error });
        process.exit(1);
    }
};
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
// pm2 restart
process.on('SIGUSR2', () => gracefulShutdown('SIGUSR2'));
// pm2 reload
process.on('SIGHUP', () => gracefulShutdown('SIGHUP'));
const productionBots = [
    'summary',
    'mahjong',
    'pocky',
    'emoji-notifier',
    'sushi-bot',
    'shogi',
    'tiobot',
    'checkin',
    'tahoiya',
    'channel-notifier',
    'prime',
    'dajare',
    'sunrise',
    'ahokusa',
    // ...(word2vecInstalled ? ['vocabwar'] : []),
    'ricochet-robots',
    'scrapbox',
    'slack-log',
    'welcome',
    'deploy',
    'achievements',
    'mail-hook',
    'wordhero',
    'wordhero/crossword',
    'oauth',
    'tunnel',
    'voiperrobot',
    'atcoder',
    'lyrics',
    'better-custom-response',
    'emoxpand',
    'ponpe',
    'anime',
    'anime/anison',
    'oogiri',
    'sorting-riddles',
    'tsglive',
    'emoji-modifier',
    'context-free',
    'room-gacha',
    'taiko',
    'hayaoshi',
    'twitter-dm-notifier',
    'hitandblow',
    'discord',
    'octas',
    'pwnyaa',
    'amongyou',
    'api',
    'hangman',
    'hakatashi-visor',
    'nojoin',
    'remember-english',
    'golfbot',
    'kirafan/quiz',
    'topic',
    'bungo-quiz',
    'adventar',
    'jantama',
    'tabi-gatcha',
    'achievement-quiz',
    'wadokaichin',
    'wordle-battle',
    // 'slow-quiz',
    'dicebot',
    'taimai',
    'map-guessr',
    'character-quiz',
    'shmug',
    'pilot',
    'qrcode-quiz',
    'oneiromancy',
    'auto-archiver',
    'city-symbol',
    'nmpz',
    'autogen-quiz',
    'twenty-questions',
];
const developmentBots = [
    'helloworld',
];
const allBots = [...productionBots, ...developmentBots];
log.info('slackbot started');
const argv = yargs_1.default
    .array('only')
    .choices('only', allBots)
    .default('only', productionBots)
    .default('startup', 'ｼｭｯｼｭｯ (起動音)')
    .argv;
const plugins = (0, lodash_1.uniq)(argv.only);
if (plugins.length !== argv.only.length) {
    log.info(`Some plugins are specified more than once. Duplicated plugins were removed.`);
}
slack_1.eventClient.on('error', (error) => {
    log.error(`EventsAPI error ${error.message}`, { error, stack: error.stack });
});
(async () => {
    await fastify.register(formbody_1.default);
    await fastify.register(express_1.default);
    fastify.use('/slack-event', (req, res, next) => {
        if (!{}.hasOwnProperty.call(req.headers, 'x-slack-signature')) {
            res.statusCode = 400;
            res.end('Bad Request');
            return;
        }
        next();
    });
    const loggingHandler = (type) => (async (req, res, next) => {
        const body = await new Promise((resolve) => {
            req.pipe((0, concat_stream_1.default)((body) => {
                resolve(body);
            }));
        });
        const decodedBody = body.toString();
        const header = `Incoming ${type}:\n`;
        let data = null;
        if (decodedBody.startsWith('{')) {
            data = JSON.parse(decodedBody);
        }
        else {
            const parsedBody = querystring_1.default.parse(decodedBody);
            data = parsedBody?.payload ? JSON.parse(parsedBody.payload.toString()) : parsedBody;
        }
        const inspectedBody = (0, util_1.inspect)(type === 'Event' ? data?.event : data, { colors: true });
        log.info(header + inspectedBody);
        // @ts-expect-error
        req.rawBody = Buffer.from(body);
        next();
    });
    fastify.use('/slack-event', loggingHandler('Event'));
    fastify.use('/slack-event', slack_1.eventClient.expressMiddleware());
    fastify.use('/slack-message', loggingHandler('Interactive Message'));
    fastify.use('/slack-message', slack_1.messageClient.requestListener());
    const loadedPlugins = new Set();
    const authority = (0, slackUtils_1.getAuthorityLabel)();
    const initializationMessage = await slack_1.webClient.chat.postMessage({
        username: `tsgbot [${authority}]`,
        channel: process.env.CHANNEL_SANDBOX,
        text: `起動中⋯⋯ (${loadedPlugins.size}/${plugins.length})`,
        attachments: plugins.map((name) => ({
            color: '#F44336',
            text: `*loading:* ${name}`,
        })),
    });
    const throttleLoadingMessageUpdate = (0, lodash_1.throttle)(() => {
        slack_1.webClient.chat.update({
            channel: process.env.CHANNEL_SANDBOX,
            ts: initializationMessage.ts,
            text: `起動中⋯⋯ (${loadedPlugins.size}/${plugins.length})`,
            attachments: [
                {
                    color: '#4CAF50',
                    text: `*loaded:* ${Array.from(loadedPlugins).join(', ')}`,
                },
                ...plugins.filter((name) => !loadedPlugins.has(name)).map((name) => ({
                    color: '#F44336',
                    text: `*loading:* ${name}`,
                })),
            ],
        });
    }, 0.5 * 1000);
    await Promise.all(plugins.map(async (name) => {
        const plugin = await Promise.resolve(`${`./${name}`}`).then(s => __importStar(require(s)));
        if (typeof plugin === 'function') {
            await plugin({ webClient: slack_1.webClient, eventClient: slack_1.tsgEventClient, messageClient: slack_1.messageClient });
        }
        if (typeof plugin.default === 'function') {
            await plugin.default({ webClient: slack_1.webClient, eventClient: slack_1.tsgEventClient, messageClient: slack_1.messageClient });
        }
        if (typeof plugin.server === 'function') {
            await fastify.register(plugin.server({ webClient: slack_1.webClient, eventClient: slack_1.tsgEventClient, messageClient: slack_1.messageClient }));
        }
        loadedPlugins.add(name);
        log.info(`plugin "${name}" successfully loaded`);
        throttleLoadingMessageUpdate();
    }));
    fastify.listen({
        port: process.env.PORT ? parseInt(process.env.PORT) : 21864,
        host: '0.0.0.0',
    }, (error, address) => {
        if (error) {
            log.error(`fastify.listen error ${error.message}`, { error, stack: error.stack });
        }
        else {
            log.info(`Server launched at ${address}`);
        }
    });
    log.info('Launched');
    slack_1.webClient.chat.postMessage({
        username: `tsgbot [${authority}]`,
        channel: process.env.CHANNEL_SANDBOX,
        text: argv.startup,
    });
})();
