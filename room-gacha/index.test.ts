jest.mock('tinyreq');

import roomGacha from './index';
// @ts-expect-error
import Slack from '../lib/slackMock.js';
// @ts-expect-error
import tinyreq from 'tinyreq';
import { promises as fs } from 'fs';
import { stripIndents } from 'common-tags';

let slack: Slack = null;

beforeEach(async () => {
    slack = new Slack();
    process.env.CHANNEL_SANDBOX = slack.fakeChannel;
    await roomGacha(slack);
});

describe('room-gacha', () => {
    it('responds to "物件ガチャ" with a prefecture and a city specified', async () => {
        tinyreq.impl = jest.fn(async (url, callback) => {
            const data = await fs.readFile(`${__dirname}/search-result.test.html`, 'utf-8');
            if (callback) callback(null, data);
            return data;
        });
        const response = await slack.getResponseTo('物件ガチャ 東京都 文京区');
        expect(response.username).toBe('物件ガチャ');
        expect(response.icon_emoji).toBe(':house:');
        expect(response.text).toBe('物件ガチャの結果だよ〜:full_moon_with_face:');
        expect(response.blocks[0].text.text).toBe('*東京都文京区の賃貸住宅[賃貸マンション・アパート]情報* (12,345件) から選んだよ〜 :full_moon_with_face:');
        expect(response.blocks[3].text.text).toBe(stripIndents`*<https://suumo.jp/chintai/bc_000000000000/|ザ・シェアハウス地下>*
            *住所*: 東京都文京区本郷７丁目３−１
            *アクセス*: 本郷三丁目駅（地下鉄丸の内線）より徒歩8分
            本郷三丁目駅（地下鉄大江戸線）より徒歩6分
            湯島駅又は根津駅（地下鉄千代田線）より徒歩8分
            東大前駅（地下鉄南北線）より徒歩1分
            春日駅（地下鉄三田線）より徒歩10分`);
        expect(response.blocks[4].fields.map(
            (field: {type: string; text: string; }) => field.text
        )).toMatchObject([
            '*家賃*\n123.4万円',
            '*間取り*\n1R',
            '*面積*\n54.3m2',
            '*向き*\n南東',
            '*築年数*\n築100年',
        ]);
        expect(response.blocks[5].image_url).toBe('https://img01.suumo.com/front/gazo/fr/bukken/000/000000000000/000000000000_ef.jpg');
    });
});
