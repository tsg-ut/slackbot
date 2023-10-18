jest.mock('tinyreq');
jest.mock('axios');

import lyrics from './index';
import Slack from '../lib/slackMock';
// @ts-expect-error
import tinyreq from 'tinyreq';
import axios from 'axios';
import { oneLineTrim, stripIndent } from 'common-tags';

let slack: Slack = null;

beforeEach(async () => {
    slack = new Slack();
    process.env.CHANNEL_SANDBOX = slack.fakeChannel;
    await lyrics(slack);
});

describe('lyrics', () => {
    it('responds to @lyrics query', async () => {
        tinyreq.impl = jest.fn(async (url, callback) => {
            if (url.includes('index_search')) { // Song search result
                const data = oneLineTrim`
                    <html><body><dl id="search_list">
                        <dt>
                            <span><a href="/song/159792/">とまどい→レシピ</a></span>
                            <a>みかくにんぐッ!</a>　（作詞：<a>Junky</a>/作曲：<a>Junky</a>）
                        </dt>
                        <dd></dd>
                    </dl></body></html>`;
                if (callback) {
                    callback(null, data);
                }
                return data;
            }
            if (url.includes('song')) { // Lyrics page
                const data = oneLineTrim`
                    <html><head>
                        <link rel="canonical" href="https://www.uta-net.com/song/159792/">
                    </head><body><div id="main">
                        <div class="row"><div><div><div>
                            <div>
                                <h2>とまどい→レシピ</h2>
                                <h3><a><span itemprop="byArtist name">みかくにんぐッ!</span></a></h3>
                            </div>
                            <div></div>
                            <div>
                                <p>未確認で進行形 オープニング</p>
                                <p class="detail">
                                    作詞：<a href="/lyricist/7740/" itemprop="lyricist">Junky</a><br>
                                    作曲：<a href="/composer/9401/" itemprop="composer">Junky</a><br>
                                    発売日：2014/02/19<br>                                    この曲の表示回数：106,837回
                                </p>
                            </div>
                        </div></div></div></div>
                        <div id="kashi"><div><div id="kashi_area">
                            略
                            <br><br>
                            朝目が覚めたらもう昨日みたいな日常はなくて
                            <br>
                            「ホントあぁもう...えっとどうしよう」
                            <br>
                            ため息混じりに練るお菓子と妄想のレシピの中に
                            <br>
                            恋心入っちゃった
                            <br><br>
                            略
                        </div></div></div>
                    </div></body></html>`;
                if (callback) {
                    callback(null, data);
                }
                return data;
            }
        });

        // @ts-expect-error
        axios.get = jest.fn(async (url) => {
            if (url.includes('itunes')) { // iTunes Search API
                return { data: {
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
                        artistViewUrl: 'https://music.apple.com/jp/artist/%E3%81%BF%E3%81%8B%E3%81%8F%E3%81%AB%E3%82%93%E3%81%90%E3%83%83/834179764?uo=4',
                        collectionViewUrl: 'https://music.apple.com/jp/album/%E3%81%A8%E3%81%BE%E3%81%A9%E3%81%84-%E3%83%AC%E3%82%B7%E3%83%94/977931267?i=977931270&uo=4',
                        trackViewUrl: 'https://music.apple.com/jp/album/%E3%81%A8%E3%81%BE%E3%81%A9%E3%81%84-%E3%83%AC%E3%82%B7%E3%83%94/977931267?i=977931270&uo=4',
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
                        isStreamable: true
                    }],
                }};
            }
        });
        const response = await slack.getResponseTo('@lyrics 朝目が覚めたらもう');
        expect(response.username).toBe('歌詞検索くん');
        expect(response.icon_url).toBe('https://is4-ssl.mzstatic.com/image/thumb/Music5/v4/52/33/6a/52336ad2-e139-98f3-fad8-fcf8edee53ab/source/60x60bb.jpg');
        expect(response.attachments[0].title).toBe('歌詞 - 歌ネット');
        expect(response.attachments[0].title_link).toBe('https://www.uta-net.com/song/159792/');
        expect(response.text).toContain(stripIndent`
            ＊朝目が覚めたらもう＊昨日みたいな日常はなくて
            「ホントあぁもう...えっとどうしよう」
            ため息混じりに練るお菓子と妄想のレシピの中に
            恋心入っちゃった`);
        const fields = response.attachments[0].fields;
        expect(fields[0].value).toBe('とまどい→レシピ');
        expect(fields[1].value).toBe('みかくにんぐッ!');
        expect(fields[2].value).toBe('Junky');
        expect(fields[3].value).toBe('Junky');
        expect(fields[4].value).toBe('<https://audio-ssl.itunes.apple.com/itunes-assets/Music3/v4/b9/89/51/b9895103-3789-c03b-4e0e-988ea41bdb13/mzaf_5579405382980491669.plus.aac.p.m4a|試聴>, <https://music.apple.com/jp/album/%E3%81%A8%E3%81%BE%E3%81%A9%E3%81%84-%E3%83%AC%E3%82%B7%E3%83%94/977931267?i=977931270&uo=4|Apple Music>');
    });
});
