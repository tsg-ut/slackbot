import winston from 'winston';
// @ts-expect-error
import {Syslog as WinstonSyslog} from 'winston-syslog';
import {inspect} from 'util';

const logger = winston.createLogger({
	level: 'info',
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
					winston.format.printf(({level, message, timestamp}) => {
						const time = new Date(timestamp);
						const hh = time.getHours().toString().padStart(2, '0');
						const mm = time.getMinutes().toString().padStart(2, '0');
						const ss = time.getSeconds().toString().padStart(2, '0');
						const prettyMessage = typeof message === 'string' ? message : inspect(message, {colors: true});
						return `[${level}] \x1b[90m${hh}:${mm}:${ss}\x1b[0m ${prettyMessage}`;
					}),
				),
			}),

		...(
			process.env.PAPERTRAIL_PORT ?
			[
				new WinstonSyslog({
					host: process.env.PAPERTRAIL_HOSTNAME,
					port: parseInt(process.env.PAPERTRAIL_PORT),
					protocol: 'tls4',
				}),
			] : []
		),
	],
});

export default logger;
