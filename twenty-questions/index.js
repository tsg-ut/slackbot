"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const slackUtils_1 = require("../lib/slackUtils");
const TwentyQuestions_1 = require("./TwentyQuestions");
const async_mutex_1 = require("async-mutex");
exports.default = async (slackInterface) => {
    const mutex = new async_mutex_1.Mutex();
    const twentyQuestions = await TwentyQuestions_1.TwentyQuestions.create(slackInterface);
    slackInterface.eventClient.on('message', async (event) => {
        const message = (0, slackUtils_1.extractMessage)(event);
        if (message !== null &&
            message.channel === process.env.CHANNEL_SANDBOX &&
            message.text === '20の扉') {
            mutex.runExclusive(() => twentyQuestions.startGame(message.user));
        }
    });
};
