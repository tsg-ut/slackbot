/* eslint-env node, jest */

jest.mock('axios');
jest.mock('./tokenize.js');
jest.mock('../achievements');

const dajare = require('./index.js');
const {default: Slack} = require('../lib/slackMock.ts');
const tokenize = require('./tokenize.js');

tokenize.virtualTokens = {
	アルミ缶の上にあるミカン: [
		{
			word_id: 2396740,
			word_type: 'KNOWN',
			word_position: 1,
			surface_form: 'アルミ',
			pos: '名詞',
			pos_detail_1: '一般',
			pos_detail_2: '*',
			pos_detail_3: '*',
			conjugated_type: '*',
			conjugated_form: '*',
			basic_form: 'アルミ',
			reading: 'アルミ',
			pronunciation: 'アルミ',
		},
		{
			word_id: 2728350,
			word_type: 'KNOWN',
			word_position: 4,
			surface_form: '缶',
			pos: '名詞',
			pos_detail_1: '一般',
			pos_detail_2: '*',
			pos_detail_3: '*',
			conjugated_type: '*',
			conjugated_form: '*',
			basic_form: '缶',
			reading: 'カン',
			pronunciation: 'カン',
		},
		{
			word_id: 93100,
			word_type: 'KNOWN',
			word_position: 5,
			surface_form: 'の',
			pos: '助詞',
			pos_detail_1: '連体化',
			pos_detail_2: '*',
			pos_detail_3: '*',
			conjugated_type: '*',
			conjugated_form: '*',
			basic_form: 'の',
			reading: 'ノ',
			pronunciation: 'ノ',
		},
		{
			word_id: 62580,
			word_type: 'KNOWN',
			word_position: 6,
			surface_form: '上',
			pos: '名詞',
			pos_detail_1: '非自立',
			pos_detail_2: '副詞可能',
			pos_detail_3: '*',
			conjugated_type: '*',
			conjugated_form: '*',
			basic_form: '上',
			reading: 'ウエ',
			pronunciation: 'ウエ',
		},
		{
			word_id: 92030,
			word_type: 'KNOWN',
			word_position: 7,
			surface_form: 'に',
			pos: '助詞',
			pos_detail_1: '格助詞',
			pos_detail_2: '一般',
			pos_detail_3: '*',
			conjugated_type: '*',
			conjugated_form: '*',
			basic_form: 'に',
			reading: 'ニ',
			pronunciation: 'ニ',
		},
		{
			word_id: 3324130,
			word_type: 'KNOWN',
			word_position: 8,
			surface_form: 'ある',
			pos: '動詞',
			pos_detail_1: '自立',
			pos_detail_2: '*',
			pos_detail_3: '*',
			conjugated_type: '五段・ラ行',
			conjugated_form: '基本形',
			basic_form: 'ある',
			reading: 'アル',
			pronunciation: 'アル',
		},
		{
			word_id: 2688280,
			word_type: 'KNOWN',
			word_position: 10,
			surface_form: 'ミカン',
			pos: '名詞',
			pos_detail_1: '一般',
			pos_detail_2: '*',
			pos_detail_3: '*',
			conjugated_type: '*',
			conjugated_form: '*',
			basic_form: 'ミカン',
			reading: 'ミカン',
			pronunciation: 'ミカン',
		},
	],
};

let slack = null;

beforeEach(async () => {
	slack = new Slack();
	process.env.CHANNEL_SANDBOX = slack.fakeChannel;
	await dajare(slack);
});

describe('dajare', () => {
	it('reacts to dajare', () => new Promise((resolve) => {
		slack.on('reactions.add', ({name, channel, timestamp}) => {
			expect(name).toContain('zabuton');
			expect(channel).toBe(slack.fakeChannel);
			expect(timestamp).toBe(slack.fakeTimestamp);
			resolve();
		});

		slack.eventClient.emit('message', {
			channel: slack.fakeChannel,
			text: 'アルミ缶の上にあるミカン',
			user: slack.fakeUser,
			ts: slack.fakeTimestamp,
		});
	}));
	it('responds to "@dajare" query', async () => {
		const {username, text} = await slack.getResponseTo('@dajare アルミ缶の上にあるミカン');

		expect(username).toBe('dajare');
		expect(text).toContain('*アルミカン*');
	});
});
