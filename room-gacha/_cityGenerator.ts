import scrapeIt from 'scrape-it';
import { promises as fs } from 'fs';
import { stripIndent } from 'common-tags';
import { Prefectures, PrefectureKanji, PrefectureRomaji } from './Prefectures';

interface City {
    name: string;
    key: string;
}

const fetchCities = async (prefectureRomaji: PrefectureRomaji) => {
    const citySelectionUrl = `https://suumo.jp/chintai/${prefectureRomaji}/city/mansion/`;
    const result = await scrapeIt<{ cities: City[]}>(citySelectionUrl, {
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
    });
    return result.data.cities;
};

(async () => {
    const cityDictionary: {[key in PrefectureKanji]?: City[]} = {};
    for (const prefKanji of Object.keys(Prefectures) as PrefectureKanji[]) {
        const prefRomaji = Prefectures[prefKanji];
        const cities = await fetchCities(prefRomaji);
        cityDictionary[prefKanji] = cities;
    }
    const json = JSON.stringify(cityDictionary, null, '    ');
    const head = stripIndent`
        import { PrefectureKanji } from './Prefectures';

        export interface City {
            name: string;
            key: string;
        }

        export const Cities: {[key in PrefectureKanji]: City[]} =`;
    const body = `${head} ${json};`;
    await fs.writeFile(`${__dirname}/Cities.ts`, body);
})();