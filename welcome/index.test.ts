import axios from 'axios';

import Slack from '../lib/slackMock';

import welcome from './index';

jest.mock('axios');

const apiData = `:tada:TSGへようこそ！:tada:
uouofishlife. uouo. uouo.

*Slackについて* :slack:
ここはオンラインチャットツールSlackの、TSGのスペースです。
`;
const welcomeMessage = `:tada:TSGへようこそ！:tada:
uouofishlife. uouo. uouo.

*Slackについて* :slack:
ここはオンラインチャットツールSlackの、TSGのスペースです。
`;

// @ts-expect-error
axios.response = {
	data: apiData,
};

let slack: Slack = null;

beforeEach(async () => {
	slack = new Slack();
	await welcome(slack);
});

describe('welcome', () => {
	it('respond to DM welcome', async () => {
		const fakeDMChannel = 'Dxxxxxx';
		slack.fakeChannel = fakeDMChannel;

		const resp = await slack.getResponseTo('welcome'); 

		const {text} = resp;

		expect(text).toBe(welcomeMessage);
	});
});
