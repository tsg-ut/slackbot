// Slack url_verificationに応答するよ君
//
// Slack君は、Events APIの受信URLに設定されたURLが、まともなものであることを確認するために、
// 一番はじめにurl_verificationというペイロードを送り、それに応じた所定のレスポンスを返すことを確認します。
// cf. https://api.slack.com/events/url_verification

import assert from 'assert';
import logger from '../lib/logger';
const log = logger.child({bot: 'slack-verify'});

import dotenv from 'dotenv';
dotenv.config();

import Fastify from 'fastify';
const fastify = Fastify();

fastify.post('/slack-event', async (req, res) => {
  // https://api.slack.com/events/url_verification
  const {challenge, type} = req.body as any;

  assert(type === 'url_verification');

  return res.send(challenge);
});

fastify.listen({
  port: process.env.PORT ? parseInt(process.env.PORT) : 21864,
  host: '0.0.0.0',
}, (error, address) => {
  if (error) {
	log.error(`fastify.listen error ${error.message}`, {error, stack: error.stack});
  } else {
	log.info(`Server launched at ${address}`);
  }
});
