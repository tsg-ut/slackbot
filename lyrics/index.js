"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getMovieInfo = exports.getSongInfo = void 0;
const axios_1 = __importDefault(require("axios"));
const scrape_it_1 = __importDefault(require("scrape-it"));
const html_entities_1 = require("html-entities");
const lodash_1 = require("lodash");
const querystring_1 = __importDefault(require("querystring"));
const getiTunesInfo = async (title, artist) => {
    const iTunesSearchAPIUrl = 'https://itunes.apple.com/search';
    const response = await axios_1.default.get(iTunesSearchAPIUrl, {
        params: {
            term: `${title} ${artist}`,
            country: 'JP',
            media: 'music',
        },
    });
    const results = response.data.results;
    if (results.length === 0)
        return { audioUrl: null, artworkUrl: null };
    return {
        audioUrl: results[0].previewUrl,
        artworkUrl: results[0].artworkUrl60,
        appleMusicUrl: results[0].trackViewUrl,
    };
};
const getSongInfo = async (songInfoUrl, keyword) => {
    const fetchedSongData = (await (0, scrape_it_1.default)(songInfoUrl, {
        url: {
            selector: 'link[rel=canonical]',
            attr: 'href',
        },
        title: 'h2',
        artist: 'span[itemprop^=byArtist]',
        lyricist: 'a[itemprop=lyricist]',
        composer: 'a[itemprop=composer]',
        kashiHTML: {
            selector: '#kashi_area',
            how: 'html',
            convert: x => (0, html_entities_1.decode)(x),
        },
    })).data;
    const paragraphs = fetchedSongData.kashiHTML.split('<br><br>').map(paragraph => paragraph.replace(/<br>/g, '\n').replace(/　/g, ' ') // <br>で改行し、全角空白を半角空白に置換
    );
    const matchingParagraphs = paragraphs.filter(paragraph => paragraph.includes(keyword));
    const formattedMatchingParagraphs = matchingParagraphs.map(paragraph => paragraph.replace(new RegExp((0, lodash_1.escapeRegExp)(keyword), 'g'), '＊$&＊'));
    const itunesInfo = await getiTunesInfo(fetchedSongData.title, fetchedSongData.artist);
    return {
        phrase: keyword,
        paragraph: formattedMatchingParagraphs[0], // とりあえず1つだけ出すことにする
        utaNetUrl: fetchedSongData.url,
        title: fetchedSongData.title,
        artist: fetchedSongData.artist,
        lyricist: fetchedSongData.lyricist,
        composer: fetchedSongData.composer,
        audioUrl: itunesInfo.audioUrl,
        artworkUrl: itunesInfo.artworkUrl,
        appleMusicUrl: itunesInfo.appleMusicUrl,
        paragraphs,
    };
};
exports.getSongInfo = getSongInfo;
const getMovieInfo = async (movieInfoUrl) => {
    const movies = (await (0, scrape_it_1.default)(movieInfoUrl, {
        embedLink: {
            selector: '.col-12.p-0 > iframe',
            attr: 'src',
        },
    })).data;
    return {
        embedLink: movies.embedLink,
        id: new URL(movies.embedLink).pathname.split('/')[2],
    };
};
exports.getMovieInfo = getMovieInfo;
const search = async (keyword) => {
    const utaNetHost = 'https://www.uta-net.com';
    const response = await (0, scrape_it_1.default)(`${utaNetHost}/user/index_search/search2.html?${querystring_1.default.encode({
        md: 'Kashi', // 歌詞検索
        st: 'Title1', // タイトル昇順ソート
        rc: 200, // 1ページの件数
        kw: keyword,
    })}`, {
        songs: {
            listItem: '#search_list > dt',
            data: {
                infoPath: {
                    selector: 'a:first-child',
                    attr: 'href',
                },
            },
        },
    });
    if (response.data.songs.length === 0)
        return null;
    const song = (0, lodash_1.sample)(response.data.songs);
    const songInfo = await (0, exports.getSongInfo)(new URL(song.infoPath, utaNetHost).href, keyword);
    return songInfo;
};
exports.default = async ({ eventClient, webClient }) => {
    eventClient.on('message', async (message) => {
        if (message.channel !== process.env.CHANNEL_SANDBOX)
            return;
        if (!message.text)
            return;
        if (message.text.startsWith('@lyrics ')) {
            const keyword = message.text.replace('@lyrics ', '');
            const songInfo = await search(keyword);
            let defaultResponseFormat = {
                channel: message.channel,
                username: '歌詞検索くん',
                icon_emoji: ':musical_note:',
            };
            if (songInfo) {
                const fields = [
                    {
                        "title": "曲名",
                        "value": songInfo.title,
                        "short": true
                    },
                    {
                        "title": "歌手",
                        "value": songInfo.artist,
                        "short": true
                    },
                    {
                        "title": "作詞",
                        "value": songInfo.lyricist,
                        "short": true
                    },
                    {
                        "title": "作曲",
                        "value": songInfo.composer,
                        "short": true
                    },
                ];
                if (songInfo.audioUrl) { // It also has artworkUrl
                    const links = [
                        [songInfo.audioUrl, '試聴'],
                    ];
                    if (songInfo.appleMusicUrl) {
                        links.push([songInfo.appleMusicUrl, 'Apple Music']);
                    }
                    fields.push({
                        "title": "リンク",
                        "value": links.map(l => `<${l[0]}|${l[1]}>`).join(', '),
                        "short": false
                    });
                    defaultResponseFormat = {
                        channel: message.channel,
                        username: '歌詞検索くん',
                        icon_url: songInfo.artworkUrl,
                    };
                }
                await webClient.chat.postMessage({
                    ...defaultResponseFormat,
                    text: songInfo.paragraph,
                    attachments: [
                        {
                            title: '歌詞 - 歌ネット',
                            title_link: songInfo.utaNetUrl,
                            fields,
                        },
                    ],
                });
            }
            else {
                await webClient.chat.postMessage({
                    ...defaultResponseFormat,
                    text: 'その歌詞は見つからなかったよ:cry:',
                });
            }
        }
        else {
            return;
        }
    });
};
