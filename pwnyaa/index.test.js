"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
/* eslint-disable no-undef */
const fs_1 = require("fs");
const path_1 = __importDefault(require("path"));
const slackMock_1 = __importDefault(require("../lib/slackMock"));
const slackUtils_1 = require("../lib/slackUtils");
const BasicTypes_1 = require("./lib/BasicTypes");
const AHManager_1 = require("./lib/AHManager");
const CHManager_1 = require("./lib/CHManager");
const KSNManager_1 = require("./lib/KSNManager");
const TWManager_1 = require("./lib/TWManager");
const XYZManager_1 = require("./lib/XYZManager");
const index_1 = __importDefault(require("./index"));
jest.mock('../achievements');
jest.unmock('axios');
jest.mock('./lib/AHManager');
jest.mock('./lib/CHManager');
jest.mock('./lib/TWManager');
jest.mock('./lib/XYZManager');
jest.mock('./lib/KSNManager');
jest.mock('../lib/slackUtils');
let slack = null;
// eslint-disable-next-line array-plural/array-plural
const sampleChallsTW = [
    { name: 'twChallA', score: 100, id: '1' },
    { name: 'twChallB', score: 200, id: '2' },
    { name: 'twChallC', score: 300, id: '39' },
];
// eslint-disable-next-line array-plural/array-plural
const sampleChallsXYZ = [
    { name: 'xyzChallA', score: 400, id: '1' },
    { name: 'xyzChallB', score: 500, id: '2' },
];
// eslint-disable-next-line array-plural/array-plural
const sampleChallsCH = [
    { name: 'chChallA', score: 400, id: '1' },
    { name: 'chChallB', score: 500, id: '2' },
];
// eslint-disable-next-line array-plural/array-plural
const sampleChallsKSN = [
    { name: 'ksnChallA', score: 400, id: '1' },
    { name: 'ksnChallB', score: 500, id: '2' },
];
// eslint-disable-next-line array-plural/array-plural
const sampleChallsAH = [
    { name: 'ahChallA', score: 400, id: '1' },
    { name: 'ahChallB', score: 500, id: '2' },
];
// eslint-disable-next-line no-unused-vars
const NOW = 'August 20, 2020 09:00:00';
// solved an hour ago
const sampleSolved1 = {
    id: '0',
    name: 'first',
    score: 100,
    solvedAt: new Date('August 20, 2020 08:00:00'),
};
// solved 2 days ago
const sampleSolved2 = {
    id: '2',
    name: 'second',
    score: 200,
    solvedAt: new Date('August 18, 2020 09:00:00'),
};
// solved 2 weeks ago
const sampleSolved3 = {
    id: '3',
    name: 'third',
    score: 300,
    solvedAt: new Date('August 06, 2020 09:00:00'),
};
const sampleProfileTW = {
    username: 'azaika',
    country: 'JP',
    rank: '20/1000',
    score: '3000',
    comment: 'Crazy Summer',
    registeredAt: '2020/01/27',
    solvedChalls: [sampleSolved1, sampleSolved2, sampleSolved3],
};
const sampleProfileXYZ = {
    username: 'hogeko',
    country: 'JP',
    rank: '30/1000',
    score: '4000',
    comment: 'Crazy Winter',
    registeredAt: '2020/01/27',
    solvedChalls: [sampleSolved1, sampleSolved2, sampleSolved3],
};
const sampleProfileCH = {
    username: 'hogeko',
    country: 'JP',
    rank: '30/1000',
    score: '4000',
    comment: 'Crazy Winter',
    registeredAt: '2020/01/27',
    solvedChalls: [sampleSolved1],
};
const sampleProfileKSN = {
    username: 'hogeko',
    country: 'JP',
    rank: '30/1000',
    score: '4000',
    comment: 'Crazy Winter',
    registeredAt: '2020/01/27',
    solvedChalls: [sampleSolved1],
};
const sampleProfileAH = {
    username: 'hogeko',
    country: 'JP',
    rank: '30/1000',
    score: '4000',
    comment: 'Crazy Winter',
    registeredAt: '2020/01/27',
    solvedChalls: [sampleSolved1],
};
beforeAll(async () => {
    // backup state file
    const stateOriginalPath = path_1.default.resolve(__dirname, 'state.json');
    const stateBackupPath = path_1.default.resolve(__dirname, 'state.json.bkup');
    const exists = await fs_1.promises.access(stateOriginalPath, fs_1.constants.F_OK)
        .then(() => true).catch(() => false);
    const originalState = {
        users: [],
        contests: [],
        ...(exists ? JSON.parse((await fs_1.promises.readFile(stateOriginalPath)).toString()) : {}),
    };
    await fs_1.promises.writeFile(stateBackupPath, JSON.stringify(originalState));
});
afterAll(async () => {
    // restore state file
    const stateOriginalPath = path_1.default.resolve(__dirname, 'state.json');
    const stateBackupPath = path_1.default.resolve(__dirname, 'state.json.bkup');
    const exists = await fs_1.promises.access(stateOriginalPath, fs_1.constants.F_OK)
        .then(() => true).catch(() => false);
    const originalState = {
        users: [],
        contests: [],
        ...(exists ? JSON.parse((await fs_1.promises.readFile(stateBackupPath)).toString()) : {}),
    };
    await fs_1.promises.writeFile(stateOriginalPath, JSON.stringify(originalState));
});
beforeEach(async () => {
    const getProfile = (profile) => new Promise((resolve, _reject) => {
        resolve(profile);
    });
    const getChalls = (challs) => new Promise((resolve, _reject) => {
        resolve(challs);
    });
    const getUser = () => new Promise((resolve, _reject) => {
        resolve({ userid: 'fakeid', name: 'fakename' });
    });
    // mock funcs containing axios calls
    TWManager_1.fetchChallsTW.mockReturnValue(sampleChallsTW);
    TWManager_1.fetchUserProfileTW.mockReturnValue(sampleProfileTW);
    XYZManager_1.fetchChallsXYZ.mockReturnValue(sampleChallsXYZ);
    XYZManager_1.fetchUserProfileXYZ.mockReturnValue(sampleProfileXYZ);
    CHManager_1.fetchChallsCH.mockReturnValue(sampleChallsCH);
    CHManager_1.fetchUserProfileCH.mockReturnValue(sampleProfileCH);
    KSNManager_1.fetchChallsKSN.mockReturnValue(sampleChallsKSN);
    KSNManager_1.fetchUserProfileKSN.mockReturnValue(sampleProfileKSN);
    AHManager_1.fetchChallsAH.mockReturnValue(sampleChallsAH);
    AHManager_1.fetchUserProfileAH.mockReturnValue(sampleProfileAH);
    slackUtils_1.getMemberName.mockReturnValue('FakeName');
    slack = new slackMock_1.default();
    process.env.CHANNEL_PWNABLE_TW = slack.fakeChannel;
    // this information(user IDs on the contests) is not credential, don't worry.
    const fakeState = {
        users: [{ slackId: slack.fakeUser, idCtf: '' }],
        contests: [
            {
                url: 'https://pwnable.tw',
                id: 0,
                title: 'pwnable.tw',
                alias: ['tw'],
                joiningUsers: [{ slackId: slack.fakeUser, idCtf: '23718' }],
                numChalls: 46,
                achievementType: BasicTypes_1.AchievementType.RATIO,
                achievementStr: 'tw',
                fetchUserProfile: (_username) => getProfile(sampleProfileTW),
                fetchChalls: () => getChalls(sampleChallsTW),
                findUserByName: (_username) => getUser(),
            },
            {
                url: 'https://pwnable.xyz',
                id: 1,
                title: 'pwnable.xyz',
                alias: ['xyz'],
                joiningUsers: [],
                numChalls: 51,
                achievementType: BasicTypes_1.AchievementType.RATIO,
                achievementStr: 'xyz',
                fetchUserProfile: (_username) => getProfile(sampleProfileXYZ),
                fetchChalls: () => getChalls(sampleChallsXYZ),
                findUserByName: (_username) => getUser(),
            },
            {
                url: 'https://cryptohack.org',
                id: 2,
                title: 'cryptohack',
                alias: ['cryptohack', 'ch'],
                joiningUsers: [],
                numChalls: 51,
                achievementType: BasicTypes_1.AchievementType.RATIO,
                achievementStr: 'ch',
                fetchUserProfile: (_username) => getProfile(sampleProfileCH),
                fetchChalls: () => getChalls(sampleChallsCH),
                findUserByName: (_username) => getUser(),
            },
            {
                url: 'https://ksnctf.sweetduet.info',
                id: 3,
                title: 'ksnctf',
                alias: ['ksn', 'ksnctf'],
                joiningUsers: [],
                numChalls: 31,
                achievementType: BasicTypes_1.AchievementType.RATIO,
                achievementStr: 'ksn',
                fetchUserProfile: (_username) => getProfile(sampleProfileKSN),
                fetchChalls: () => getChalls(sampleChallsKSN),
                findUserByName: (_username) => getUser(),
            },
        ],
    };
    // set fake state
    const stateOriginalPath = path_1.default.resolve(__dirname, 'state.json');
    try {
        await fs_1.promises.unlink(stateOriginalPath);
    }
    catch {
        console.log('[test] state.json doesn\'t exists.');
    }
    await fs_1.promises.writeFile(stateOriginalPath, JSON.stringify(fakeState));
    jest.useFakeTimers();
    const { initPromise } = await (0, index_1.default)(slack);
    await initPromise;
});
it('respond to usage', async () => {
    const { channel, text } = await slack.getResponseTo('@pwnyaa usage');
    expect(channel).toBe(slack.fakeChannel);
    expect(text).toContain('list');
    expect(text).toContain('join');
    expect(text).toContain('check');
});
it('respond to help', async () => {
    const { channel, text } = await slack.getResponseTo('@pwnyaa help');
    expect(channel).toBe(slack.fakeChannel);
    expect(text).toContain('list');
    expect(text).toContain('join');
    expect(text).toContain('check');
});
it('respond to list', async () => {
    const { channel } = await slack.getResponseTo('@pwnyaa list');
    expect(channel).toBe(slack.fakeChannel);
});
it('respond to check tw', async () => {
    const { channel, text } = await slack.getResponseTo('@pwnyaa check tw');
    expect(channel).toBe(slack.fakeChannel);
    expect(text).toContain('azaika');
    expect(text).toContain('Crazy Summer');
    expect(text).toContain('解いた問題');
});
it('respond to check xyz without joining', async () => {
    const { channel, text } = await slack.getResponseTo('@pwnyaa check xyz');
    expect(channel).toBe(slack.fakeChannel);
    expect(text).toContain('参加してないよ');
});
it('respond to check ch without joining', async () => {
    const { channel, text } = await slack.getResponseTo('@pwnyaa check ch');
    expect(channel).toBe(slack.fakeChannel);
    expect(text).toContain('参加してないよ');
});
it('respond to check ksn without joining', async () => {
    const { channel, text } = await slack.getResponseTo('@pwnyaa check ksn');
    expect(channel).toBe(slack.fakeChannel);
    expect(text).toContain('参加してないよ');
});
it('respond to check', async () => {
    const { channel, text } = await slack.getResponseTo('@pwnyaa check');
    expect(channel).toBe(slack.fakeChannel);
    expect(text).toContain('check');
    expect(text).toContain('ステータス確認');
});
it('respond to join hoge fuga', async () => {
    const { channel, text } = await slack.getResponseTo('@pwnyaa join hoge fuga');
    expect(channel).toBe(slack.fakeChannel);
    expect(text).toContain('は見つからなかったよ');
});
it('respond to join tw', async () => {
    const { channel, text } = await slack.getResponseTo('@pwnyaa join tw');
    expect(channel).toBe(slack.fakeChannel);
    expect(text).toContain('join');
    expect(text).toContain('登録する');
});
it('respond to join xyz', async () => {
    const { channel, text } = await slack.getResponseTo('@pwnyaa join xyz');
    expect(channel).toBe(slack.fakeChannel);
    expect(text).toContain('join');
    expect(text).toContain('登録する');
});
it('respond to join ch', async () => {
    const { channel, text } = await slack.getResponseTo('@pwnyaa join ch');
    expect(channel).toBe(slack.fakeChannel);
    expect(text).toContain('join');
    expect(text).toContain('登録する');
});
it('respond to join ksn', async () => {
    const { channel, text } = await slack.getResponseTo('@pwnyaa join ksn');
    expect(channel).toBe(slack.fakeChannel);
    expect(text).toContain('join');
    expect(text).toContain('登録する');
});
it('respond to stat', async () => {
    const { channel, text } = await slack.getResponseTo('@pwnyaa stat');
    expect(channel).toBe(slack.fakeChannel);
    expect(text).toContain('状況だよ');
});
