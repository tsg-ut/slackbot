const winston = require('winston');
require('dotenv').config();

const logger = winston.createLogger({
	level: 'info',
	format: winston.format.combine(
		winston.format.timestamp(),
		winston.format.json(),
	),
	transports: [
		new winston.transports.Console({timestamp: true}),
	],
});

module.exports = logger;