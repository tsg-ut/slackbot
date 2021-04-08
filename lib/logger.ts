import winston from 'winston';
// @ts-ignore
import {Syslog as WinstonSyslog} from 'winston-syslog';

const prettyFormatter = winston.format((info, opts) => {
	info.level = `[${info.level.toUpperCase()}]`

	return {
		level: info.level,
		message: info.message,
	};
});

const logger = winston.createLogger({
	level: 'info',
	format: winston.format.combine(
		winston.format.timestamp(),
		winston.format.json(),
	),
	transports: [
		...(
			process.env.NODE_ENV === 'production' ?
		[new winston.transports.Console()] :
		[new winston.transports.Console({
			format: winston.format.combine(
				winston.format((info) => {
					info.level = info.level.toUpperCase();
					return info;
				})(),
				winston.format.colorize(),
				winston.format.printf(({ level, message, label, timestamp }) => {
					const time = new Date(timestamp);
					const hh = time.getHours().toString().padStart(2, '0');
					const mm = time.getMinutes().toString().padStart(2, '0');
					const ss = time.getSeconds().toString().padStart(2, '0');
					return `[${level}] \x1b[90m${hh}:${mm}:${ss}\x1b[0m ${message}`;
				}),
			),
		})]

		),
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

export default logger;
