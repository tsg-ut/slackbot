const winston = require('winston');
const {LoggingWinston} = require('@google-cloud/logging-winston');
require('dotenv').load();

const loggingWinston = new LoggingWinston({
  labels: {
    name: 'tsg-slackbot',
    version: '1.0.0',
  },
  serviceContext: {
    service: 'tsg-slackbot',
    version: '1.0.0',
  },
});

const logger = winston.createLogger({
  level: 'info',
  transports: [
    new winston.transports.Console(),
    ...(process.env.NODE_ENV === 'production' ? [loggingWinston] : []),
  ],
});

module.exports = logger;