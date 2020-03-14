import scrapeIt from 'scrape-it';
import { promises as fs } from 'fs';
import * as qs from 'querystring';
import _ from 'lodash';
import type { SlackInterface } from '../lib/slack';
import { prefectures, PrefectureKanji } from './prefectures';

interface Image {
    url: string;
    description: string;
}

interface Room {
    name: string;
    url: string;
    images: Image[];
    layoutImageUrl: string;
    rent: string;
    layout: string;
    size: string;
    direction: string;
    years: string;
    address: string;
    access: string[];
}

const pickOneResult = async (cityIDs: string[], ar: string, bs: string, ta: string) => {
    const appAddress = 'https://suumo.jp/jj/chintai/ichiran/FR301FC005/'; // 部屋ごとに表示
    const queries = {
        sc: cityIDs,
        ar, bs, ta, // 謎 (必須) (都道府県固有)
        po01: '09', // 並び替え: 新着順
        pc: '100',  // 表示件数: 100件
    };
    const url = `${appAddress}?${qs.stringify(queries)}`;
    interface SearchResult {
        title: string;
        hit: string;
        rooms: Room[];
    }
    const result = await scrapeIt<SearchResult>(url, {
        title: {
            selector: '.ui-section-header h1',
            convert: s => s.split(' ')[0],
        },
        hit: '.paginate_set-hit',
        rooms: {
            listItem: '.property',
            data: {
                name: '.property_inner-title a',
                url: {
                    selector: '.property_inner-title a',
                    attr: 'href',
                    convert: s => new URL(s, 'https://suumo.jp').href,
                },
                images: {
                    listItem: '.cassette_carrousel-item li',
                    data: {
                        url: {
                            selector: 'img',
                            attr: 'rel',
                        },
                        description: {
                            selector: 'img',
                            attr: 'alt',
                        },
                    },
                },
                layoutImageUrl: {
                    selector: 'img[alt=間取り]',
                    attr: 'rel',
                },
                rent: '.detailbox-property-point',
                layout: {
                    selector: '.detailbox-property--col3 div',
                    eq: 0,
                },
                size: {
                    selector: '.detailbox-property--col3 div',
                    eq: 1,
                },
                direction: {
                    selector: '.detailbox-property--col3 div',
                    eq: 2,
                },
                years: {
                    selector: '.detailbox-property--col3 div',
                    eq: 4,
                },
                address: {
                    selector: '.detailbox-property-col',
                    eq: 4,
                },
                access: {
                    selector: '.detailnote-box',
                    eq: 0,
                    convert: s => s.split('\n').map((e: string) => e.trim()),
                },
            },
        },
    });
    const searchResult = result.data;
    const pickedRoom = _.sample(searchResult.rooms);
    return { title: searchResult.title, hit: searchResult.hit, room: pickedRoom };
};

export default async ({rtmClient, webClient}: SlackInterface) => {
    interface Data {
        sc: {[key in PrefectureKanji]: {[key: string]: string}};
        hiddenValue: {[key in PrefectureKanji]: {
            ar: string,
            bs: string;
            ta: string;
        }};
    }

    const dataStr = await fs.readFile(`${__dirname}/data.json`, 'utf-8');
    const data: Data = JSON.parse(dataStr);
    const { sc, hiddenValue } = data;
    rtmClient.on('message', async message => {
        const username = '物件ガチャ';
        if (message.channel !== process.env.CHANNEL_SANDBOX) return;
        if (!message.text) return;
        if (message.username === username) return;
        if (message.text.startsWith('物件ガチャ')) {
            const args: string[] = message.text.split(' ');
            const prefs = Object.keys(prefectures);
            const isValidPrefSpecified = args.length > 1 && prefs.includes(args[1]);
            const pref = (isValidPrefSpecified ? args[1] : _.sample(prefs)) as PrefectureKanji;
            const cityNames = Object.keys(sc[pref]);
            let cityKeys = [];
            for (const arg of args.slice(2)) {
                if (cityNames.includes(arg)) cityKeys.push(sc[pref][arg]);
            }
            if (cityKeys.length === 0) {
                cityKeys = Object.values(sc[pref]); // 全ての街を検索対象に
            }
            const { ar, bs, ta } = hiddenValue[pref];
            const result = await pickOneResult(cityKeys.filter(s => s !== ''), ar, bs, ta);
            if (result.room === undefined) {
                await webClient.chat.postMessage({
                    channel: message.channel,
                    username,
                    icon_emoji: ':house:',
                    text: '家が見つからなかったよ :new_moon_with_face:',
                });
                return;
            }
            const blocks = [
                {
                    type: 'section',
                    text: {
                        type: 'mrkdwn',
                        text: `*${result.title}* (${result.hit}) から選んだよ〜 :full_moon_with_face:`,
                    },
                },
                {
                    type: "context",
                    elements: [{
                        type: 'mrkdwn',
                        text: 'Usage: `物件ガチャ [都道府県名] [地域名 (空白区切りで複数可)]`\n* 都道府県名は未指定の場合ランダムに選ばれます。\n* 地域名は未指定の場合全てが選択されます。',
                    }],
                },
                { type: 'divider' },
                {
                    type: 'section',
                    text: {
                        type: 'mrkdwn',
                        text: `*<${result.room.url}|${result.room.name}>*\n*住所*: ${result.room.address}\n*アクセス*: ${result.room.access.join('\n')}`,
                    },
                    accessory: {
                        type: 'image',
                        image_url: result.room.images[0].url,
                        alt_text: result.room.images[0].description,
                    },
                },
                {
                    type: 'section',
                    fields: [
                        {
                            type: 'mrkdwn',
                            text: `*家賃*\n${result.room.rent}`,
                        },
                        {
                            type: 'mrkdwn',
                            text: `*間取り*\n${result.room.layout}`,
                        },
                        {
                            type: 'mrkdwn',
                            text: `*面積*\n${result.room.size}`,
                        },
                        {
                            type: 'mrkdwn',
                            text: `*向き*\n${result.room.direction}`,
                        },
                        {
                            type: 'mrkdwn',
                            text: `*築年数*\n${result.room.years}`,
                        },
                    ],
                },
                {
                    type: 'image',
                    title: { type: 'plain_text', text: '間取り図' },
                    image_url: result.room.layoutImageUrl,
                    alt_text: '間取り図',
                },
            ];
            await webClient.chat.postMessage({
                channel: message.channel,
                username,
                icon_emoji: ':house:',
                icon_url: '',
                text: '物件ガチャの結果だよ〜:full_moon_with_face:',
                blocks,
            });
        }
    });
};