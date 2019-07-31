import axios from 'axios';
import { JSDOM } from 'jsdom';
import { RTMClient, WebClient } from '@slack/client';

interface SongInfo {
    phrase: string;
    paragraph: string;
    title: string;
    artist: string;
    lyricist: string;
    composer: string;
    utaNetUrl: string;
}

interface SlackInterface {
    rtmClient: RTMClient;
    webClient: WebClient;
}

const getSongInfo = async (songInfoUrl: string, keyword: string): Promise<SongInfo> => {
    const response = await axios.get(songInfoUrl);
    const source = response.data;
    const document = new JSDOM(source).window.document;
    const view = document.getElementById('view_kashi');
    const title = view.getElementsByTagName('h2')[0].textContent;
    const artist = view.getElementsByTagName('h3')[0].textContent;
    const lyricist = (view.querySelector('h4[itemprop=lyricist]') as HTMLElement).textContent;
    const composer = (view.querySelector('h4[itemprop=composer]') as HTMLElement).textContent;
    const kashiHTML = document.getElementById('kashi_area').innerHTML;
    const paragraphs = kashiHTML.split('<br><br>').map(paragraph => {
        return paragraph.replace(/<br>/g, '\n').replace(/　/g, ' ');
    });
    console.log(paragraphs);
    const matchingParagraphs = paragraphs.filter(paragraph => paragraph.indexOf(keyword) !== -1);
    console.log(matchingParagraphs);
    const formattedMathingParagraphs = matchingParagraphs.map(paragraph => {
        return paragraph.replace(new RegExp(keyword, 'g'), ' *$&* ');
    });
    return {
        phrase: keyword,
        paragraph: formattedMathingParagraphs[0], // とりあえず1つだけ出すことにする
        utaNetUrl: songInfoUrl,
        title, artist, lyricist, composer
    };
};

const search = async (keyword: string): Promise<SongInfo | null> => {
    const utaNetHost = 'https://www.uta-net.com';
    const searchPageUrl = `${utaNetHost}/user/index_search/search2.html`;
    console.log(keyword.replace(/ /g, '　'))
    const response = await axios.get(searchPageUrl, {
        params: {
            md: 'Kashi', // 歌詞検索
            st: 'Title1', // タイトル昇順ソート。アレンジ曲などが存在する場合、最も短い曲名を選びたいため。
            kw: keyword.replace(/ /g, '　'),
        }
    });
    const source = response.data;
    const results = new JSDOM(source).window.document.getElementById('search_list').children;
    if (results.length === 0) {
        return null;
    } else {
        const firstResult = results[0];
        const songInfoPath = firstResult.getElementsByTagName('a')[0].href; // 初めのリンクが曲ページへのリンク
        const songInfo = await getSongInfo(`${utaNetHost}${songInfoPath}`, keyword);
        return songInfo;
    }
};

(async () => {
    const result = await search('作りましょう 作りましょう');
    console.log(result);
})();

export default async ({rtmClient, webClient}: SlackInterface) => {
    rtmClient.on('message', async message => {
        if (message.channel !== process.env.CHANNEL_SANDBOX) {
            return;
        }
        if (!message.text) {
            return;
        }
        if (message.text.match(/^@lyrics/)) {
            const keyword = message.text.replace('@lyrics ', '');
            const songInfo: SongInfo | null = await search(keyword);
            const defaultResponseFormat = {
                channel: message.channel,
                username: '歌詞検索くん',
                icon_emoji: ':musical_note:',
                thread_ts: message.thread_ts || message.ts,
                reply_broadcast: true,
            };
            if (songInfo) {
                await webClient.chat.postMessage({
                    ...defaultResponseFormat,
                    text: songInfo.paragraph,
                    attachments: [
                        {
                            title: '歌詞 - 歌ネット',
                            title_link: songInfo.utaNetUrl,
                            fields: [
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
                            ],
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
