/* eslint-disable no-undef */

import {constants, promises as fs} from 'fs';
import path from 'path';
// @ts-ignore
import Slack from '../lib/slackMock.js';
import {getMemberName} from '../lib/slackUtils';
import {Challenge, SolvedInfo} from './lib/BasicTypes';
import {fetchChallsTW, fetchUserProfileTW, profileTW} from './lib/TWManager';
import {fetchChallsXYZ, fetchUserProfileXYZ, profileXYZ} from './lib/XYZManager';
import pwnyaa, {State} from './index';

jest.mock('../achievements');
jest.unmock('axios');
jest.mock('./lib/TWManager');
jest.mock('./lib/XYZManager');
jest.mock('../lib/slackUtils');

let slack: Slack = null;

// eslint-disable-next-line array-plural/array-plural
const sampleChallsTW: Challenge[] = [
	{name: 'twChallA', score: 100, id: '1'},
	{name: 'twChallB', score: 200, id: '2'},
	{name: 'twChallC', score: 300, id: '39'},
];
// eslint-disable-next-line array-plural/array-plural
const sampleChallsXYZ: Challenge[] = [
	{name: 'xyzChallA', score: 400, id: '1'},
	{name: 'xyzChallB', score: 500, id: '2'},
];

// eslint-disable-next-line no-unused-vars
const NOW = 'August 20, 2020 09:00:00';

// solved an hour ago
const sampleSolved1: SolvedInfo = {
	id: '0',
	name: 'first',
	score: 100,
	solvedAt: new Date('August 20, 2020 08:00:00'),
};
// solved 2 days ago
const sampleSolved2: SolvedInfo = {
	id: '2',
	name: 'second',
	score: 200,
	solvedAt: new Date('August 18, 2020 09:00:00'),
};
// solved 2 weeks ago
const sampleSolved3: SolvedInfo = {
	id: '3',
	name: 'third',
	score: 300,
	solvedAt: new Date('August 06, 2020 09:00:00'),
};

const sampleProfileTW: profileTW = {
	username: 'azaika',
	country: 'JP',
	rank: '20/1000',
	score: '3000',
	comment: 'Crazy Summer',
	registeredAt: '2020/01/27',
	solvedChalls: [sampleSolved1, sampleSolved2, sampleSolved3],
};

const sampleProfileXYZ: profileXYZ = {
	username: 'hogeko',
	country: 'JP',
	rank: '30/1000',
	score: '4000',
	comment: 'Crazy Winter',
	registeredAt: '2020/01/27',
	solvedChalls: [sampleSolved1, sampleSolved2, sampleSolved3],
};


beforeAll(async () => {
	// backup state file
	const stateOriginalPath = path.resolve(__dirname, 'state.json');
	const stateBackupPath = path.resolve(__dirname, 'state.json.bkup');
	const exists = await fs.access(stateOriginalPath, constants.F_OK)
		.then(() => true).catch(() => false);
	const originalState: State = {
		users: [],
		contests: [],
		...(exists ? JSON.parse((await fs.readFile(stateOriginalPath)).toString()) : {}),
	};
	await fs.writeFile(stateBackupPath, JSON.stringify(originalState));
});

afterAll(async () => {
	// restore state file
	const stateOriginalPath = path.resolve(__dirname, 'state.json');
	const stateBackupPath = path.resolve(__dirname, 'state.json.bkup');
	const exists = await fs.access(stateOriginalPath, constants.F_OK)
		.then(() => true).catch(() => false);
	const originalState: State = {
		users: [],
		contests: [],
		...(exists ? JSON.parse((await fs.readFile(stateBackupPath)).toString()) : {}),
	};
	await fs.writeFile(stateOriginalPath, JSON.stringify(originalState));
});

beforeEach(async () => {
	// mock funcs containing axios calls
	(fetchChallsTW as jest.Mock).mockReturnValue(sampleChallsTW);
	(fetchUserProfileTW as jest.Mock).mockReturnValue(sampleProfileTW);
	(fetchChallsXYZ as jest.Mock).mockReturnValue(sampleChallsXYZ);
	(fetchUserProfileXYZ as jest.Mock).mockReturnValue(sampleProfileXYZ);
	(getMemberName as jest.Mock).mockReturnValue('FakeName');

	slack = new Slack();
	process.env.CHANNEL_PWNABLE_TW = slack.fakeChannel;

	// this information(user IDs on the contests) is not credential, don't worry.
	const fakeState: State = {
		users: [{slackId: slack.fakeUser, idCtf: ''}],
		contests: [
			{
				url: 'https://pwnable.tw',
				id: 0,
				title: 'pwnable.tw',
				alias: ['tw'],
				joiningUsers: [{slackId: slack.fakeUser, idCtf: '23718'}],
				numChalls: 46,
			},
			{
				url: 'https://pwnable.xyz',
				id: 1,
				title: 'pwnable.xyz',
				alias: ['xyz'],
				joiningUsers: [],
				numChalls: 51,
			},
		],
	};

	// set fake state
	const stateOriginalPath = path.resolve(__dirname, 'state.json');
	await fs.writeFile(stateOriginalPath, JSON.stringify(fakeState));

	jest.useFakeTimers();
	await pwnyaa(slack);
});


it('respond to usage', async () => {
	const {channel, text}: { channel: string, text: string } = await slack.getResponseTo('@pwnyaa usage');

	expect(channel).toBe(slack.fakeChannel);
	expect(text).toContain('list');
	expect(text).toContain('join');
	expect(text).toContain('check');
});

it('respond to help', async () => {
	const {channel, text}: { channel: string, text: string } = await slack.getResponseTo('@pwnyaa help');

	expect(channel).toBe(slack.fakeChannel);
	expect(text).toContain('list');
	expect(text).toContain('join');
	expect(text).toContain('check');
});

it('respond to list', async () => {
	const {channel, text}: { channel: string, text: string } = await slack.getResponseTo('@pwnyaa list');

	expect(channel).toBe(slack.fakeChannel);
	expect(text).toContain('pwnable.tw');
	expect(text).toContain('問題数: 3');
	expect(text).toContain('参加者: 1匹');
	expect(text).toContain('FakeName');
	expect(text).toContain('pwnable.xyz');
	expect(text).toContain('問題数: 2');
	expect(text).toContain('参加者: なし');
});

it('respond to check tw', async () => {
	const {channel, text}: { channel: string, text: string } = await slack.getResponseTo('@pwnyaa check tw');

	expect(channel).toBe(slack.fakeChannel);
	expect(text).toContain('azaika');
	expect(text).toContain('Crazy Summer');
	expect(text).toContain('解いた問題');
});

it('respond to check xyz without joining', async () => {
	const {channel, text}: { channel: string, text: string } = await slack.getResponseTo('@pwnyaa check xyz');

	expect(channel).toBe(slack.fakeChannel);
	expect(text).toContain('参加してないよ');
});

it('respond to check', async () => {
	const {channel, text}: { channel: string, text: string } = await slack.getResponseTo('@pwnyaa check');

	expect(channel).toBe(slack.fakeChannel);
	expect(text).toContain('check');
	expect(text).toContain('ステータス確認');
});

it('respond to join hoge fuga', async () => {
	const {channel, text}: { channel: string, text: string } = await slack.getResponseTo('@pwnyaa join hoge fuga');

	expect(channel).toBe(slack.fakeChannel);
	expect(text).toContain('は見つからなかったよ');
});

it('respond to join tw', async () => {
	const {channel, text}: { channel: string, text: string } = await slack.getResponseTo('@pwnyaa join tw');

	expect(channel).toBe(slack.fakeChannel);
	expect(text).toContain('join');
	expect(text).toContain('登録する');
});
