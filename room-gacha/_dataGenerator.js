"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchData = void 0;
const scrape_it_1 = __importDefault(require("scrape-it"));
const fs_1 = require("fs");
const prefectures_1 = require("./prefectures");
const fetchData = async (prefectureRomaji) => {
    const citySelectionUrl = `https://suumo.jp/chintai/${prefectureRomaji}/city/`;
    const result = await (0, scrape_it_1.default)(citySelectionUrl, {
        cities: {
            listItem: '.searchitem-list li',
            data: {
                name: {
                    selector: 'label span',
                    eq: 0,
                },
                key: {
                    selector: 'input',
                    attr: 'value',
                },
            },
        },
        ar: { selector: 'input[name=ar]', attr: 'value' },
        bs: { selector: 'input[name=bs]', attr: 'value' },
        ta: { selector: 'input[name=ta]', attr: 'value' },
    });
    return result.data;
};
exports.fetchData = fetchData;
(async () => {
    const cityDictionary = {};
    const hiddenValueDictionary = {};
    for (const prefKanji of Object.keys(prefectures_1.prefectures)) {
        const prefRomaji = prefectures_1.prefectures[prefKanji];
        const { cities, ar, bs, ta } = await (0, exports.fetchData)(prefRomaji);
        const dict = {};
        cities.forEach(city => { dict[city.name] = city.key; });
        cityDictionary[prefKanji] = dict;
        hiddenValueDictionary[prefKanji] = { ar, bs, ta };
    }
    const cityJson = JSON.stringify(cityDictionary, null, '    ');
    const hiddenValueJson = JSON.stringify(hiddenValueDictionary, null, '    ');
    await fs_1.promises.writeFile(`${__dirname}/data.json`, `{ "sc": ${cityJson}, "hiddenValue": ${hiddenValueJson}}`);
})();
