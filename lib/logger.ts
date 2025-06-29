import winston from 'winston';
// @ts-expect-error
import {Syslog as WinstonSyslog} from 'winston-syslog';
import {inspect} from 'util';
import type {FastifyLogFn} from 'fastify';
// @ts-expect-error
import {serializers} from 'fastify/lib/logger';

const logger = winston.createLogger({
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
	format: winston.format.combine(
		winston.format.timestamp(),
		winston.format.json(),
	),
	transports: [
		process.env.NODE_ENV === 'production' ?
			new winston.transports.Console() :
			new winston.transports.Console({
				level: 'debug',
				format: winston.format.combine(
					winston.format((info) => {
						info.level = info.level.toUpperCase();
						return info;
					})(),
					winston.format.colorize(),
					winston.format.printf(({level, message, timestamp, bot}) => {
						const time = new Date(timestamp);
						const hh = time.getHours().toString().padStart(2, '0');
						const mm = time.getMinutes().toString().padStart(2, '0');
						const ss = time.getSeconds().toString().padStart(2, '0');
						const timeString = `\x1b[90m${hh}:${mm}:${ss}\x1b[0m`;
						const botString = bot ? ` \x1b[35m(${bot})\x1b[0m` : '';

						if (typeof message?.res === 'object') {
							message.res = serializers.res(message.res);
						}

						if (typeof message?.req === 'object') {
							const method = message.req?.method ?? '';
							const url = message.req?.url ?? '';
							return `[${level}] ${timeString}${botString} \x1b[36m${method}\x1b[0m \x1b[35m${url}\x1b[0m`;
						}
						
						const prettyMessage = typeof message === 'string' ? message : inspect(message, {colors: true});
						return `[${level}] ${timeString}${botString} ${prettyMessage}`;
					}),
				),
			}),

		...(
			process.env.PAPERTRAIL_PORT ?
			[
				new WinstonSyslog({
					host: process.env.PAPERTRAIL_HOSTNAME,
					port: parseInt(process.env.PAPERTRAIL_PORT),
				}),
			] : []
		),
	],
});

export type SlackbotLogger = winston.Logger & {
	fatal: FastifyLogFn,
	trace: FastifyLogFn,
	silent: FastifyLogFn,
	child(options: {bot: string}): SlackbotLogger,
};

export default logger as SlackbotLogger;
