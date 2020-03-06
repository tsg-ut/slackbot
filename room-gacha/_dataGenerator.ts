import scrapeIt from 'scrape-it';
import { promises as fs } from 'fs';
import { stripIndent } from 'common-tags';
import { Prefectures, PrefectureKanji, PrefectureRomaji } from './Prefectures';

interface City {
    name: string;
    key: string;
}

interface HiddenValue {
    ar: string;
    bs: string;
    ta: string;
}

const fetchData = async (prefectureRomaji: PrefectureRomaji) => {
    const citySelectionUrl = `https://suumo.jp/chintai/${prefectureRomaji}/city/`;
    const result = await scrapeIt<{
        cities: City[];
        ar: string;
        bs: string;
        ta: string;
    }>(citySelectionUrl, {
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

(async () => {
    const cityDictionary: {[key in PrefectureKanji]?: {[key: string]: string}} = {};
    const hiddenValueDictionary: {[key in PrefectureKanji]?: HiddenValue} = {};
    for (const prefKanji of Object.keys(Prefectures) as PrefectureKanji[]) {
        const prefRomaji = Prefectures[prefKanji];
        const { cities, ar, bs, ta } = await fetchData(prefRomaji);
        const dict: {[key: string]: string} = {};
        cities.forEach(city => { dict[city.name] = city.key });
        cityDictionary[prefKanji] = dict;
        hiddenValueDictionary[prefKanji] = { ar, bs, ta};
    }
    const cityJson = JSON.stringify(cityDictionary, null, '    ');
    const hiddenValueJson = JSON.stringify(hiddenValueDictionary, null, '    ');
    const body = `import { PrefectureKanji } from './Prefectures';
interface HiddenValue {
    ar: string;
    bs: string;
    ta: string;
}
export const Cities: {[key in PrefectureKanji]: {[key: string]: string}} =${cityJson};
export const HiddenValue: {[key in PrefectureKanji]: HiddenValue} =${hiddenValueJson};`;
    await fs.writeFile(`${__dirname}/Data.ts`, body);
})();