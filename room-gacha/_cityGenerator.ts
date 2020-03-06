import scrapeIt from 'scrape-it';
import { promises as fs } from 'fs';
import { stripIndent } from 'common-tags';
import { Prefectures, PrefectureKanji, PrefectureRomaji } from './Prefectures';

interface City {
    name: string;
    key: string;
}

const fetchCities = async (prefectureRomaji: PrefectureRomaji) => {
    const citySelectionUrl = `https://suumo.jp/chintai/${prefectureRomaji}/city/`;
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
    const cityDictionary: {[key in PrefectureKanji]?: {[key: string]: string}} = {};
    for (const prefKanji of Object.keys(Prefectures) as PrefectureKanji[]) {
        const prefRomaji = Prefectures[prefKanji];
        const cities = await fetchCities(prefRomaji);
        const dict: {[key: string]: string} = {};
        cities.forEach(city => { dict[city.name] = city.key });
        cityDictionary[prefKanji] = dict;
    }
    const json = JSON.stringify(cityDictionary, null, '    ');
    const head = stripIndent`
        import { PrefectureKanji } from './Prefectures';

        export const Cities: {[key in PrefectureKanji]: {[key: string]: string}} =`;
    const body = `${head} ${json};`;
    await fs.writeFile(`${__dirname}/Cities.ts`, body);
})();