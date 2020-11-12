const winston = require('winston');
require('dotenv').config();
require('winston-syslog');

const logger = winston.createLogger({
	level: 'info',
	format: winston.format.combine(
		winston.format.timestamp(),
		winston.format.json(),
	),
	transports: [
		new winston.transports.Console({timestamp: true}),
		new winston.transports.Syslog({
			host: process.env.PAPERTRAIL_HOSTNAME,
			port: parseInt(process.env.PAPERTRAIL_PORT),
		}),
	],
});

module.exports = logger;