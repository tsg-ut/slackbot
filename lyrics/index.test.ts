import lyrics from './index';
// @ts-ignore
import Slack from '../lib/slackMock.js';
jest.mock('axios');
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
        // @ts-ignore
        axios.get = jest.fn(async url => {
            if (url.includes('index_search')) { // Song search result
                return { data: oneLineTrim`
                    <html><body><dl id="search_list">
                        <dt>
                            <span><a href="/song/159792/">とまどい→レシピ</a></span>
                            <a>みかくにんぐッ!</a>　（作詞：<a>Junky</a>/作曲：<a>Junky</a>）
                        </dt>
                        <dd></dd>
                    </dl></body></html>` };
            }
            if (url.includes('song')) { // Lyrics page
                return { data: oneLineTrim`
                    <html><body><div id="view_kashi">
                        <div class="title">
                            <h2>とまどい→レシピ</h2>
                        </div>
                        <div class="artist_etc clearfix">
                            <div class="kashi_artist">
                                歌手：<h3><a><span>みかくにんぐッ!</span></a></h3>
                                <br>
                                作詞：<h4 itemprop=lyricist><a>Junky</a></h4>
                                <br>
                                作曲：<h4 itemprop=composer><a>Junky</a></h4>
                            </div>
                        </div>
                        <div id="flash_area"><div><div id="kashi_area">
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
                    </div></body></html>` };
            }
            if (url.includes('itunes')) { // iTunes Search API
                return { data:  {
                    resultCount: 1,
                    results: [{ // 一部パラメータは削りましたが、今後改良で使いそうなパラメータは残しておきました
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
                        previewUrl: 'https://audio-ssl.itunes.apple.com/itunes-assets/Music3/v4/b9/89/51/b9895103-3789-c03b-4e0e-988ea41bdb13/mzaf_5579405382980491669.plus.aac.p.m4a',
                        artworkUrl30: 'https://is4-ssl.mzstatic.com/image/thumb/Music5/v4/52/33/6a/52336ad2-e139-98f3-fad8-fcf8edee53ab/source/30x30bb.jpg',
                        artworkUrl60: 'https://is4-ssl.mzstatic.com/image/thumb/Music5/v4/52/33/6a/52336ad2-e139-98f3-fad8-fcf8edee53ab/source/60x60bb.jpg',
                        artworkUrl100: 'https://is4-ssl.mzstatic.com/image/thumb/Music5/v4/52/33/6a/52336ad2-e139-98f3-fad8-fcf8edee53ab/source/100x100bb.jpg',
                        collectionPrice: 1000,
                        trackPrice: 250,
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
                    }]
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
        expect(fields[4].value).toBe('https://audio-ssl.itunes.apple.com/itunes-assets/Music3/v4/b9/89/51/b9895103-3789-c03b-4e0e-988ea41bdb13/mzaf_5579405382980491669.plus.aac.p.m4a');
    });
});
