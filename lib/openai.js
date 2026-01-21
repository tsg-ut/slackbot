"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.systemOpenAIClient = void 0;
const openai_1 = __importDefault(require("openai"));
const firestore_1 = __importDefault(require("./firestore"));
const logger_1 = __importDefault(require("./logger"));
const mp3_duration_1 = __importDefault(require("mp3-duration"));
const firebase_admin_1 = require("firebase-admin");
const dayjs_1 = __importDefault(require("dayjs"));
const lodash_1 = require("lodash");
const slack_1 = require("./slack");
const discord_1 = __importDefault(require("./discord"));
const assert_1 = __importDefault(require("assert"));
const log = logger_1.default.child({ bot: 'lib/openai' });
const COST_LIMIT_PER_DAY = 0.3; // USD
const OpenAIUsageLog = firestore_1.default.collection('openai_usage_logs');
const openai = new openai_1.default({
    apiKey: process.env.OPENAI_API_KEY,
});
const formatDurationInHours = (durationInHours) => {
    const hours = Math.floor(durationInHours);
    const minutes = Math.floor(durationInHours * 60) % 60;
    const seconds = Math.floor(durationInHours * 3600) % 60;
    const HH = hours.toString().padStart(2, '0');
    const MM = minutes.toString().padStart(2, '0');
    const SS = seconds.toString().padStart(2, '0');
    return `${HH}:${MM}:${SS}`;
};
const checkUsageLimit = async (errorDestination) => {
    const now = new Date();
    const oneDayAgo = (0, dayjs_1.default)(now).subtract(1, 'day').toDate();
    const query = OpenAIUsageLog.where('createdAt', '>=', oneDayAgo).orderBy('createdAt', 'desc');
    const snapshot = await query.get();
    const totalCost = (0, lodash_1.sumBy)(snapshot.docs, (doc) => doc.data().cost ?? 0);
    log.debug(`Total OpenAI usage cost in the last 24 hours: $${totalCost.toFixed(4)}`);
    if (totalCost >= COST_LIMIT_PER_DAY) {
        let resetTime = (0, dayjs_1.default)(now).add(1, 'day').toDate().getTime();
        let accumulatedCost = 0;
        for (const doc of snapshot.docs) {
            const data = doc.data();
            accumulatedCost += data.cost ?? 0;
            if (accumulatedCost >= COST_LIMIT_PER_DAY) {
                break;
            }
            resetTime = Math.min(resetTime, (0, dayjs_1.default)(data.createdAt.toDate()).add(1, 'day').toDate().getTime());
        }
        const resetsIn = (0, dayjs_1.default)(resetTime).diff((0, dayjs_1.default)(now), 'hour', true);
        const message = `OpenAI API usage limit exceeded! Total cost in the last 24 hours: $${totalCost.toFixed(4)}. Resets in ${formatDurationInHours(resetsIn)}`;
        if (errorDestination === 'slack') {
            await slack_1.webClient.chat.postMessage({
                channel: process.env.CHANNEL_SANDBOX,
                text: message,
            });
        }
        else if (errorDestination === 'discord') {
            const discordTextSandbox = discord_1.default.channels.cache.get(process.env.DISCORD_SANDBOX_TEXT_CHANNEL_ID);
            await discordTextSandbox?.send(message);
        }
        throw new Error(message);
    }
};
const checkAudioSpeechCreateModel = (params) => {
    const model = params.model;
    if (model === 'gpt-4o-mini-tts' ||
        model === 'tts-1' ||
        model === 'tts-1-hd') {
        return model;
    }
    throw new Error(`Unsupported model for audio.speech.create: ${params.model}`);
};
const audioSpeechCreate = async (params) => {
    await checkUsageLimit('discord');
    const model = checkAudioSpeechCreateModel(params);
    const response = await openai.audio.speech.create(params);
    if (response.status !== 200) {
        log.error(`OpenAI audio.speech.create failed: ${response.status} - ${response.statusText}`);
        return;
    }
    let cost = null;
    const data = await response.arrayBuffer();
    if (model === 'gpt-4o-mini-tts') {
        // The price for the gpt-4o-mini-tts model is calculated against the number of tokens, but
        // currently it is not possible to get the usage information from the response.
        // For now, we will use the official cost estimation equation provided by OpenAI:
        // $0.015 / minute
        // https://community.openai.com/t/how-do-i-calculate-the-usage-cost-when-using-the-gpt-4o-mini-tts-model/1263804
        const duration = await (0, mp3_duration_1.default)(Buffer.from(data));
        cost = (duration / 60) * 0.015;
    }
    else {
        (0, assert_1.default)(model === 'tts-1' || model === 'tts-1-hd', `Unexpected model: ${model}`);
        // tts-1: $15.00 / 1M characters
        // tts-1-hd: $30.00 / 1M characters
        // https://platform.openai.com/docs/pricing
        const characterCount = params.input.length;
        const costPerMillionCharacters = model === 'tts-1' ? 15 : 30;
        cost = (characterCount / 1_000_000) * costPerMillionCharacters;
    }
    log.info(`OpenAI audio.speech.create API cost: $${cost?.toFixed(4) ?? 'unknown'}`);
    await OpenAIUsageLog.add({
        method: 'audio.speech.create',
        createdAt: firebase_admin_1.firestore.FieldValue.serverTimestamp(),
        model: params.model,
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        reasoningTokens: 0,
        cost,
    });
    return {
        ...response,
        data,
    };
};
const checkChatCompletionCreateModel = (params) => {
    const model = params.model;
    if (model === 'gpt-4o-mini' ||
        model === 'gpt-4.1-mini' ||
        model === 'gpt-5-mini' ||
        model === 'o4-mini') {
        return model;
    }
    throw new Error(`Unsupported model for chat.completions.create: ${params.model}`);
};
const chatCompletionCreate = async (params) => {
    await checkUsageLimit('slack');
    const model = checkChatCompletionCreateModel(params);
    const response = await openai.chat.completions.create(params);
    const promptTokens = response.usage?.prompt_tokens ?? 0;
    const completionTokens = response.usage?.completion_tokens ?? 0;
    const totalTokens = response.usage?.total_tokens ?? 0;
    const reasoningTokens = response.usage?.completion_tokens_details?.reasoning_tokens ?? 0;
    let cost = null;
    if (model === 'gpt-4o-mini') {
        // Input: $0.15 / 1M tokens
        // Output: $0.60 / 1M tokens
        // https://platform.openai.com/docs/pricing
        cost = (promptTokens / 1_000_000) * 0.15 + (completionTokens / 1_000_000) * 0.60;
    }
    else if (model === 'gpt-4.1-mini') {
        // Input: $0.40 / 1M tokens
        // Output: $1.60 / 1M tokens
        // https://platform.openai.com/docs/pricing
        cost = (promptTokens / 1_000_000) * 0.40 + (completionTokens / 1_000_000) * 1.60;
    }
    else if (model === 'gpt-5-mini') {
        // Input: $0.25 / 1M tokens
        // Output: $2.00 / 1M tokens
        // https://platform.openai.com/docs/models/gpt-5-mini
        cost = (promptTokens / 1_000_000) * 0.25 + (completionTokens / 1_000_000) * 2.00;
    }
    else {
        (0, assert_1.default)(model === 'o4-mini', `Unexpected model: ${model}`);
        // Input: $1.10 / 1M tokens
        // Output: $4.40 / 1M tokens
        // https://platform.openai.com/docs/pricing
        cost = (promptTokens / 1_000_000) * 1.10 + ((completionTokens + reasoningTokens) / 1_000_000) * 4.40;
    }
    log.info(`OpenAI chat.completions.create API cost: $${cost?.toFixed(4) ?? 'unknown'}`);
    await OpenAIUsageLog.add({
        method: 'chat.completions.create',
        createdAt: firebase_admin_1.firestore.FieldValue.serverTimestamp(),
        model: params.model,
        promptTokens,
        completionTokens,
        totalTokens,
        reasoningTokens,
        cost,
    });
    return response;
};
exports.default = {
    audio: {
        speech: {
            create: audioSpeechCreate,
        },
    },
    chat: {
        completions: {
            create: chatCompletionCreate,
        },
    },
};
exports.systemOpenAIClient = openai;
