import axios from 'axios';
import scrapeIt from 'scrape-it';
import { AllHtmlEntities } from 'html-entities';
import { RTMClient, WebClient } from '@slack/client';
import { escapeRegExp, sample } from 'lodash';
import qs from 'querystring';

interface SongInfo {
    phrase: string;
    paragraph: string;
    title: string;
    artist: string;
    lyricist: string;
    composer: string;
    utaNetUrl: string;
    audioUrl: string | null;
    artworkUrl: string | null;
}

interface iTuensInfo {
    audioUrl: string | null;
    artworkUrl: string | null;
}

interface SlackInterface {
    rtmClient: RTMClient;
    webClient: WebClient;
}

const getiTunesInfo = async (title: string, artist: string): Promise<iTuensInfo> => {
    const iTunesSearchAPIUrl = 'https://itunes.apple.com/search';
    const response = await axios.get(iTunesSearchAPIUrl, {
        params: {
            term: `${title} ${artist}`,
            country: 'JP',
            media: 'music',
        },
    });
    const results = response.data.results;
    if (results.length === 0) {
        return { audioUrl: null, artworkUrl: null };
    } else {
        return {
            audioUrl: results[0].previewUrl,
            artworkUrl: results[0].artworkUrl60,
        };
    }
};

const getSongInfo = async (songInfoUrl: string, keyword: string): Promise<SongInfo> => {
    interface fetchedSongData {
        title: string;
        artist: string;
        lyricist: string;
        composer: string;
        kashiHTML: string;
    }
    const entities = new AllHtmlEntities();
    const fetchedSongData = (await scrapeIt<fetchedSongData>(songInfoUrl, {
        title: 'h2',
        artist: 'h3',
        lyricist: 'h4[itemprop=lyricist]',
        composer: 'h4[itemprop=composer]',
        kashiHTML: {
            selector: '#kashi_area',
            how: 'html',
            convert: x => entities.decode(x),
        },
    })).data;
    const paragraphs = fetchedSongData.kashiHTML.split('<br><br>').map(paragraph =>
        paragraph.replace(/<br>/g, '\n').replace(/　/g, ' ') // <br>で改行し、全角空白を半角空白に置換
    );
    const matchingParagraphs = paragraphs.filter(paragraph => paragraph.includes(keyword));
    const formattedMatchingParagraphs = matchingParagraphs.map(paragraph => 
        paragraph.replace(new RegExp(escapeRegExp(keyword), 'g'), '＊$&＊')
    );
    const { audioUrl, artworkUrl } = await getiTunesInfo(fetchedSongData.title, fetchedSongData.artist);

    return {
        phrase: keyword,
        paragraph: formattedMatchingParagraphs[0], // とりあえず1つだけ出すことにする
        utaNetUrl: songInfoUrl,
        title: fetchedSongData.title,
        artist: fetchedSongData.artist,
        lyricist: fetchedSongData.lyricist,
        composer: fetchedSongData.composer,
        audioUrl,
        artworkUrl,
    };
};

const search = async (keyword: string): Promise<SongInfo | null> => {
    const utaNetHost = 'https://www.uta-net.com';
    const response = await scrapeIt<{songs: {infoPath: string}[]}>(`${utaNetHost}/user/index_search/search2.html?${qs.encode({
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

    if (response.data.songs.length === 0) {
        return null;
    } else {
        const song = sample(response.data.songs);
        const songInfo = await getSongInfo(new URL(song.infoPath, utaNetHost).href, keyword);
        return songInfo;
    }
};

export default async ({rtmClient, webClient}: SlackInterface) => {
    rtmClient.on('message', async message => {
        if (message.channel !== process.env.CHANNEL_SANDBOX) {
            return;
        }
        if (!message.text) {
            return;
        }
        if (message.text.startsWith('@lyrics ')) {
            const keyword = message.text.replace('@lyrics ', '');
            const songInfo: SongInfo | null = await search(keyword);
            const defaultResponseFormat = {
                channel: message.channel,
                username: '歌詞検索くん',
                icon_emoji: ':musical_note:',
                icon_url: '',
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
                    fields.push({
                        "title": "試聴リンク",
                        "value": songInfo.audioUrl,
                        "short": false
                    });
                    defaultResponseFormat.icon_url = songInfo.artworkUrl;
                    delete defaultResponseFormat.icon_emoji;
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
            } else {
                await webClient.chat.postMessage({
                    ...defaultResponseFormat,
                    text: 'その歌詞は見つからなかったよ:cry:',
                });
            }
        } else {
            return;
        }
    });
}
