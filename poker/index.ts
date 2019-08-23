import {stripIndent} from 'common-tags';
import {promises as fs, constants} from 'fs';
import path from 'path';
import {shuffle, sortBy, times, uniq} from 'lodash';
import {RTMClient, WebClient} from '@slack/client';
import Mutex from './mutex';

interface User {
  userName: string,
  score: number,
}

interface State {
  phase: string,
  candidates: any[],
  channels: any[],
  cards: number[][],
  baseCards: number[],
  leftChange: number[],
  scores: User[],
}

interface SlackInterface {
  rtmClient: RTMClient;
  webClient: WebClient;
}

const trumpKeys = ["SA", "S2", "S3", "S4", "S5", "S6", "S7", "S8", "S9", "S10", "SJ", "SQ", "SK", "HA", "H2", "H3", "H4", "H5", "H6", "H7", "H8", "H9", "H10", "HJ", "HQ", "HK", "DA", "D2", "D3", "D4", "D5", "D6", "D7", "D8", "D9", "D10", "DJ", "DQ", "DK", "CA", "C2", "C3", "C4", "C5", "C6", "C7", "C8", "C9", "C10", "CJ", "CQ", "CK"];// "JOKER"];
const trumps = ["🂡", "🂢", "🂣", "🂤", "🂥", "🂦", "🂧", "🂨", "🂩", "🂪", "🂫", "🂭", "🂮", "🂱", "🂲", "🂳", "🂴", "🂵", "🂶", "🂷", "🂸", "🂹", "🂺", "🂻", "🂽", "🂾", "🃁", "🃂", "🃃", "🃄", "🃅", "🃆", "🃇", "🃈", "🃉", "🃊", "🃋", "🃍", "🃎", "🃑", "🃒", "🃓", "🃔", "🃕", "🃖", "🃗", "🃘", "🃙", "🃚", "🃛", "🃝", "🃞"];// , "🂿"];
const handList: Record<string, number> = {
  "Royal Straight Flush": 900,
  "Straight Flush": 800,
  "Four Card": 700,
  "Full House": 600,
  "Flush": 500,
  "Straight": 400,
  "Three Card": 300,
  "Two Pair": 200,
  "One Pair": 100,
  "High Card": 0,
};

export default async ({rtmClient: rtm, webClient: slack}: SlackInterface) => {
  const leastMemeberNum: number = 1;
  const mostMemberNum: number = 6;
  const statePath = path.resolve(__dirname, 'state.json');
  const exists = await fs.access(statePath, constants.F_OK).then(() => true).catch(() => false);
  const state: Readonly<State> = Object.assign({
    phase: 'ready',
    candidates: [],
    channels: [],
    cards: [],
    baseCards: [],
    leftChange: [],
    scores: [],
  }, exists ? JSON.parse((await fs.readFile(statePath)).toString()): {});

  await fs.writeFile(statePath, String(state));
  const setState = (object: Partial<State>) => {
    Object.assign(state, object);
    return fs.writeFile(statePath, JSON.stringify(state));
  };

  const mainMutex = new Mutex();

  let timerId: NodeJS.Timer;

  const showHands = (cards: number[]) => {
    return stripIndent`
    ${cards.map((val) => trumps[val]).join('')}
    ${cards.map((val) => trumpKeys[val]).join(',')}
    `;
  };

  const getMention = (user: string) => {
    return `<@${user}>`;
  };

  const postMessage = (text: string, attachments?: any , options?: any) => {
    slack.chat.postMessage({
      channel: process.env.CHANNEL_SANDBOX,
      text,
      username: 'poker',
      // eslint-disable-next-line camelcase
      icon_emoji: ':black_joker:',
      ...(attachments ? {attachments} : {}),
      ...(options ? options : {}),
    });
  };

  const failed = (error: any) => {
    postMessage(error.stack);
  };

  const onFinishJoin = async () => {
    const humanCount: number = state.candidates.length;
    if (humanCount < leastMemeberNum) {
      await setState({
        phase: 'ready',
        candidates: [],
        channels: [],
        cards: [],
        baseCards: [],
        leftChange: [],
      });
      await postMessage("参加者が少ないのでキャンセルされたよ:face_with_rolling_eyes:");
      return;
    }

    const baseCards = state.baseCards;
    const cards: number[][]= [];

    state.candidates.forEach((_, i) => {
      const card: number[] = [];
      times(5, () => {
        card.push(baseCards.pop());
      });
      cards.push(card);
    });

    await setState({
      phase: 'change_card',
      baseCards: baseCards,
      cards: cards,
    });

    await postMessage(stripIndent`
      DMにそれぞれ手札を配るよ！1回だけ5枚まで交換していいから、交換する場合は"(S|Q|H|D)(A|2-9|10|J|Q|K)"を半角スペース区切りで <@${process.env.USER_TSGBOT}> にDMしてね。
      2分経ったら結果発表に入るよ。
    `);

    state.candidates.forEach(async (user, i) => {
      await slack.chat.postMessage({
        channel: state.channels[i],
        text: stripIndent`
        あなたの手札はこれだよ！残り変更枚数:${state.leftChange[i]} 枚
        ${showHands(state.cards[i])}
        `,
        username: 'poker',
        // eslint-disable-next-line camelcase
        icon_emoji: ':black_joker:',
      });
    });

    timerId = setTimeout(onFinishChangeCard, 1000 * 60 * 2);
  };

  const onFinishChangeCard = async () => {
    onFinishBetting();
  };

  const getScore = (idx: number) => {
    // TODO: JOKER
    // TODO: 同役の際のスーツ、ランクによる強弱判別
    const cards = state.cards[idx];
    const suits = [0, 0, 0, 0];
    const ranks = new Array(13).fill(0);
    cards.forEach((card) => {
      suits[Math.floor(card / 13)]++;
      ranks[card % 13]++;
    });

    // royal straight flush
    if (ranks[0] == 1 && ranks[9] == 1 && ranks[10] == 1 && ranks[11] == 1 && ranks[12] == 1 && suits.filter((val) => val === 5)) {
      return handList["Royal Straight Flush"];
    }

    // straight flush
    let straight = suits.concat([suits[0]]);
    straight.reverse()
    straight.forEach((val, i) => {
      if (val) {
        if (i) {
          straight[i] = straight[i - 1] + 1;
        } else {
          straight[i] = 1;
        }
      }
    });
    straight.reverse();
    const straightIdx = straight.findIndex(val => val === 5);
    if (straightIdx !== -1) {
      if (suits.filter((val) => val === 5).length > 0) {
        return handList["Straight Flush"];
      }
    }

    // four card
    const fourCardIdx = ranks.findIndex((val) => val === 4);
    if (fourCardIdx !== -1) {
      return handList["Four Card"];
    }

    // full house
    const fullHouseIdx = [ranks.findIndex((val) => val === 3), ranks.findIndex((val) => val === 2)];
    if (fullHouseIdx[0] !== -1 && fullHouseIdx[1] !== -1) {
      return handList["Full House"];
    }

    // flush
    if (suits.filter((val) => val === 5).length > 0) {
      return handList["Flush"];
    }

    // straight
    if (straightIdx !== -1) {
      return handList["Straight"];
    }

    // three card
    if (ranks.filter((val) => val === 3).length > 0) {
      return handList["Three Card"];
    }

    // two pair
    if (ranks.filter((val) => val === 2).length == 2) {
      return handList["Two Pair"];
    }

    // one pair
    if (ranks.filter((val) => val === 2).length > 0) {
      return handList["One Pair"];
    }

    return handList["High Card"];
  };

  const getNameOfHand = (score: number) => {
    for(let name in handList) {
      if (score >= handList[name]) {
        return name;
      }
    }
    return "failed to get name of hand";
  };

  const onFinishBetting = async () => {
    // scoring
    const scores = state.cards.map((_, i) => getScore(i));

    const rankings = sortBy(((new Array(scores.length)).fill(0).map((_, i) => i)), (val) => -scores[val]);

    postMessage(stripIndent`
      結果発表!!!:tada::tada::tada:
      ${rankings.map((val) => `<@${state.candidates[val].toString()}>` + " " + scores[val].toString() + " " + getNameOfHand(scores[val]) + '\n' + showHands(state.cards[val])).join('\n')}
    `);

    setState({
      phase: 'ready',
      candidates: [],
      channels: [],
      cards: [],
      baseCards: [],
      leftChange: [],
    });
  };

  rtm.on('message', async (message: any) => {
    console.log(message);
    if (!message.text || message.subtype !== undefined) {
      return;
    }

    try {
      const {text} = message;

      if (message.channel === process.env.CHANNEL_SANDBOX) {
        if (text === 'ポーカー' || text === 'poker') {
          if (state.phase !== 'ready') {
            await postMessage('今はポーカー中だよ:lmt_swallow:');
            return;
          }

          const baseCards = shuffle(Array.from(Array(52).keys()));

          await setState({
            phase: 'join',
            baseCards,
          });

          await postMessage(stripIndent`
            ポーカーを始めるよ！
            参加者は3分以内に <@${process.env.USER_TSGBOT}> にDMしてね！
          `);

          timerId = setTimeout(onFinishJoin, 1000 * 60 * 3);
        }
      }
      // DM
      if (message.channel.startsWith('D')) {
        const postDM = (text: string, attachments?: any, options?: any) => {
          slack.chat.postMessage({
            channel: message.channel,
            text,
            username: 'poker',
            // eslint-disable-next-line camelcase
            icon_emoji: ':black_joker:',
            ...(attachments ? {attachments} : {}),
            ...(options ? options : {}),
          });
        }

        const tokens = text.trim().split(/\s+/);
        if (state.phase === 'join') {
          if (message.subtype === 'bot_message' || message.user === 'USLACKBOT') {
            return;
          }
          let successJoin: boolean = false;
          await mainMutex.exec(async () => {
            const candidates = state.candidates;
            const channels = state.channels;
            const leftChange = state.leftChange;
            if (candidates.length < mostMemberNum) {
              candidates.push(message.user);
              channels.push(message.channel);
              leftChange.push(5);
              await setState({candidates, channels, leftChange});
              successJoin = true;
            }
          });

          if (successJoin) {
            await slack.reactions.add({name: '+1', channel: message.channel, timestamp: message.ts});

            const humanCount: number = state.candidates.length;
            const remainingText: string = (humanCount > leastMemeberNum ? '' : (
              humanCount === leastMemeberNum ? '(決行決定:tada:)' : `(決行まであと${leastMemeberNum - humanCount}人)`));
            await postMessage(stripIndent`
              ${getMention(message.user)} が参加するよ！現在の参加者: ${humanCount}人 ${remainingText}
            `);
          } else {
            postDM(stripIndent`ごめんね :cry: 既に最大参加人数(${mostMemberNum}人)に達してしまったよ :innocent:
            次の試合まで待つのじゃ...`);
          }
          return;
        }
        else if (state.phase === 'change_card') {
          const idx: number = state.candidates.findIndex(item => item === message.user);
          if (idx === -1) {
            return;
          }

          console.log(tokens);
          let validTokens: string[] = [];
          tokens.forEach((token: string) => {
            if (state.cards[idx].some((item: number) => trumpKeys[item] === token)) {
              validTokens.push(token);
            }
          });

          validTokens = uniq(validTokens);

          if (state.leftChange[idx] < validTokens.length) {
            postDM(`変更できるのは${state.leftChange[idx]}枚までだよ:cry:`);
            return;
          }

          // remove
          const leftChange = state.leftChange[idx] - validTokens.length;
          let cards: number[] = state.cards[idx];
          validTokens.forEach((token) => {
            cards = cards.filter((val) => trumpKeys[val] !== token);
          });

          // add
          const baseCards = state.baseCards;
          while (cards.length < 5) {
            cards.push(baseCards.pop());
          }
          const fullCards: number[][] = state.cards;
          fullCards[idx] = cards;
          const fullLeftChange: number[] = state.leftChange;
          fullLeftChange[idx] = 0;
          await setState({
            leftChange: fullLeftChange,
            cards: fullCards,
            baseCards,
          });
          if (validTokens.length > 0) {
            await postDM(stripIndent`
              ${validTokens.join(',')} を捨てたよ！残り操作回数:${state.leftChange[idx]} 回:thinking_face:
              ${showHands(state.cards[idx])}
            `);

            await postMessage(stripIndent`
              <@${state.candidates[idx].toString()}> がカードを${validTokens.length} 枚捨てたよ！
            `);
          }
        }
      }
    } catch (error) {
      failed(error);
    }
  });
}
