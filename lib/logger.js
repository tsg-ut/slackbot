"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const winston_1 = __importDefault(require("winston"));
// @ts-expect-error
const winston_syslog_1 = require("winston-syslog");
const util_1 = require("util");
// @ts-expect-error
const logger_1 = require("fastify/lib/logger");
const logger = winston_1.default.createLogger({
    level: 'info',
    levels: {
        fatal: 0,
        error: 1,
        warn: 2,
        info: 3,
        http: 4,
        verbose: 5,
        debug: 6,
        silly: 7,
        trace: 8,
        silent: 9,
    },
    format: winston_1.default.format.combine(winston_1.default.format.timestamp(), winston_1.default.format.json()),
    transports: [
        process.env.NODE_ENV === 'production' ?
            new winston_1.default.transports.Console() :
            new winston_1.default.transports.Console({
                level: 'debug',
                format: winston_1.default.format.combine(winston_1.default.format((info) => {
                    info.level = info.level.toUpperCase();
                    return info;
                })(), winston_1.default.format.colorize(), winston_1.default.format.printf(({ level, message, timestamp, bot }) => {
                    const time = new Date(timestamp);
                    const hh = time.getHours().toString().padStart(2, '0');
                    const mm = time.getMinutes().toString().padStart(2, '0');
                    const ss = time.getSeconds().toString().padStart(2, '0');
                    const timeString = `\x1b[90m${hh}:${mm}:${ss}\x1b[0m`;
                    const botString = bot ? ` \x1b[35m(${bot})\x1b[0m` : '';
                    if (typeof message?.res === 'object') {
                        message.res = logger_1.serializers.res(message.res);
                    }
                    if (typeof message?.req === 'object') {
                        const method = message.req?.method ?? '';
                        const url = message.req?.url ?? '';
                        return `[${level}] ${timeString}${botString} \x1b[36m${method}\x1b[0m \x1b[35m${url}\x1b[0m`;
                    }
                    const prettyMessage = typeof message === 'string' ? message : (0, util_1.inspect)(message, { colors: true });
                    return `[${level}] ${timeString}${botString} ${prettyMessage}`;
                })),
            }),
        ...(process.env.PAPERTRAIL_PORT ?
            [
                new winston_syslog_1.Syslog({
                    host: process.env.PAPERTRAIL_HOSTNAME,
                    port: parseInt(process.env.PAPERTRAIL_PORT),
                }),
            ] : []),
    ],
});
exports.default = logger;
