import { stripIndent } from 'common-tags';
import achievementQuiz from './';

const Slack = require('../lib/slackMock.js');

let slack: typeof Slack;

beforeEach(() => {
  slack = new Slack();
  process.env.CHANNEL_SANDBOX = slack.fakeChannel;
  achievementQuiz(slack);
});

