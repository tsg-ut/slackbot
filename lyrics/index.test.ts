vi.mock('scrape-it');
vi.mock('axios');

import lyrics from './index';
import Slack from '../lib/slackMock';
import axios from 'axios';
import scrapeIt from 'scrape-it';
import type {AxiosResponse} from 'axios';
import { stripIndent } from 'common-tags';

let slack: Slack = null;

beforeEach(async () => {
    slack = new Slack();
    process.env.CHANNEL_SANDBOX = slack.fakeChannel;
    await lyrics(slack);
});

describe('lyrics', () => {
    it('responds to @lyrics query', async () => {
        const mockScrapeIt = vi.mocked(scrapeIt);
        mockScrapeIt.mockImplementation(async (url: any) => {
            if (typeof url === 'string' && url.includes('index_search')) {
                return {data: {songs: [{infoPath: '/song/159792/'}]}} as any;
            }
            if (typeof url === 'string' && url.includes('/song/')) {
                return {data: {
                    url: 'https://www.uta-net.com/song/159792/',
                    title: 'とまどい→レシピ',
                    artist: 'みかくにんぐッ!',
                    lyricist: 'Junky',
                    composer: 'Junky',
                    kashiHTML: '略<br><br>朝目が覚めたらもう昨日みたいな日常はなくて<br>「ホントあぁもう...えっとどうしよう」<br>ため息混じりに練るお菓子と妄想のレシピの中に<br>恋心入っちゃった<br><br>略',
                }} as any;
            }
            return {data: {}} as any;
        });

        const mockAxios = vi.mocked(axios);
        mockAxios.mockImplementation(async (url: string) => {
            if (url.includes('itunes')) {
                return {data: {
                    resultCount: 1,
                    results: [{
                        wrapperType: 'track',
                        kind: 'song',
                        artistId: 834179764,
                        collectionId: 977931267,
                        trackId: 977931270,
                        artistName: 'みかくにんぐッ!',
                        collectionName: 'とまどい→レシピ - EP',
                        trackName: 'とまどい→レシピ',
                        collectionCensoredName: 'とまどい→レシピ - EP',
                        trackCensoredName: 'とまどい→レシピ',
                        artistViewUrl: 'https://music.apple.com/jp/artist/834179764?uo=4',
                        collectionViewUrl: 'https://music.apple.com/jp/album/977931267?i=977931270&uo=4',
                        trackViewUrl: 'https://music.apple.com/jp/album/977931267?i=977931270&uo=4',
                        previewUrl: 'https://audio-ssl.itunes.apple.com/itunes-assets/Music3/v4/b9/89/51/b9895103-3789-c03b-4e0e-988ea41bdb13/mzaf_5579405382980491669.plus.aac.p.m4a',
                        artworkUrl30: 'https://is4-ssl.mzstatic.com/image/thumb/Music5/v4/52/33/6a/52336ad2-e139-98f3-fad8-fcf8edee53ab/source/30x30bb.jpg',
                        artworkUrl60: 'https://is4-ssl.mzstatic.com/image/thumb/Music5/v4/52/33/6a/52336ad2-e139-98f3-fad8-fcf8edee53ab/source/60x60bb.jpg',
                        artworkUrl100: 'https://is4-ssl.mzstatic.com/image/thumb/Music5/v4/52/33/6a/52336ad2-e139-98f3-fad8-fcf8edee53ab/source/100x100bb.jpg',
                        collectionPrice: 1020,
                        trackPrice: 255,
                        releaseDate: '2014-02-19T12:00:00Z',
                        collectionExplicitness: 'notExplicit',
                        trackExplicitness: 'notExplicit',
                        discCount: 1,
                        discNumber: 1,
                        trackCount: 4,
                        trackNumber: 1,
                        trackTimeMillis: 272480,
                        country: 'JPN',
                        currency: 'JPY',
                        primaryGenreName: 'アニメ',
                        isStreamable: true,
                    }],
                }} as AxiosResponse;
            }
            return {data: ''} as AxiosResponse;
        });
        const response = await slack.getResponseTo('@lyrics 朝目が覚めたらもう');
        expect('username' in response && response.username).toBe('歌詞検索くん');
        expect(response.icon_url).toBe('https://is4-ssl.mzstatic.com/image/thumb/Music5/v4/52/33/6a/52336ad2-e139-98f3-fad8-fcf8edee53ab/source/60x60bb.jpg');
        const attachments = 'attachments' in response ? response.attachments : [];
        expect(attachments[0].title).toBe('歌詞 - 歌ネット');
        expect(attachments[0].title_link).toBe('https://www.uta-net.com/song/159792/');
        expect(response.text).toContain(stripIndent`
            ＊朝目が覚めたらもう＊昨日みたいな日常はなくて
            「ホントあぁもう...えっとどうしよう」
            ため息混じりに練るお菓子と妄想のレシピの中に
            恋心入っちゃった`);
        const fields = attachments[0].fields;
        expect(fields[0].value).toBe('とまどい→レシピ');
        expect(fields[1].value).toBe('みかくにんぐッ!');
        expect(fields[2].value).toBe('Junky');
        expect(fields[3].value).toBe('Junky');
        expect(fields[4].value).toBe('<https://audio-ssl.itunes.apple.com/itunes-assets/Music3/v4/b9/89/51/b9895103-3789-c03b-4e0e-988ea41bdb13/mzaf_5579405382980491669.plus.aac.p.m4a|試聴>, <https://music.apple.com/jp/album/977931267?i=977931270&uo=4|Apple Music>');
    });
});
