"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const scrape_it_1 = __importDefault(require("scrape-it"));
const fs_1 = require("fs");
const qs = __importStar(require("querystring"));
const lodash_1 = __importDefault(require("lodash"));
const prefectures_1 = require("./prefectures");
const pickOneResult = async (cityIDs, ar, bs, ta) => {
    const appAddress = 'https://suumo.jp/jj/chintai/ichiran/FR301FC005/'; // 部屋ごとに表示
    const queries = {
        sc: cityIDs,
        ar, bs, ta, // 謎 (必須) (都道府県固有)
        po01: '09', // 並び替え: 新着順
        pc: '100', // 表示件数: 100件
    };
    const url = `${appAddress}?${qs.stringify(queries)}`;
    const result = await (0, scrape_it_1.default)(url, {
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
                    convert: s => s.split('\n').map((e) => e.trim()),
                },
            },
        },
    });
    const searchResult = result.data;
    const pickedRoom = lodash_1.default.sample(searchResult.rooms);
    return { title: searchResult.title, hit: searchResult.hit, room: pickedRoom };
};
exports.default = async ({ eventClient, webClient }) => {
    const dataStr = await fs_1.promises.readFile(`${__dirname}/data.json`, 'utf-8');
    const data = JSON.parse(dataStr);
    const { sc, hiddenValue } = data;
    eventClient.on('message', async (message) => {
        const username = '物件ガチャ';
        if (message.channel !== process.env.CHANNEL_SANDBOX)
            return;
        if (!message.text)
            return;
        if (message.user === process.env.USER_TSGBOT)
            return;
        if (message.text === '物件ガチャ' || message.text.startsWith('物件ガチャ ')) {
            const args = message.text.split(' ');
            const prefs = Object.keys(prefectures_1.prefectures);
            const isValidPrefSpecified = args.length > 1 && prefs.includes(args[1]);
            const pref = (isValidPrefSpecified ? args[1] : lodash_1.default.sample(prefs));
            const cityNames = Object.keys(sc[pref]);
            let cityKeys = [];
            for (const arg of args.slice(2)) {
                if (cityNames.includes(arg))
                    cityKeys.push(sc[pref][arg]);
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
                text: '物件ガチャの結果だよ〜:full_moon_with_face:',
                blocks,
            });
        }
    });
};
