import Slack from '../lib/slackMock';
import path from 'path';

vi.mock('fs');
import fs from 'fs';

const kanjis = [ '山', '川', '谷', '海' ];
const dicts = Array.from({length:2}, () => [
  "山谷","山川","山海","川山","谷山","海山"
]).flat();

// @ts-ignore
fs.virtualFiles = {
  [path.join(__dirname, 'data')]: '',
  [path.join(__dirname, 'data','2KanjiWords.txt')]: dicts.join('\n'),
  [path.join(__dirname, 'data','JoyoKanjis.txt')]: kanjis.join('\n'),
};

vi.mock('lodash', async (importOriginal) => {
  const orig = await importOriginal<typeof import('lodash')>();
  const lodash: any = (orig as any).default ?? orig;
  const allMethods = Object.fromEntries(
    Object.keys(lodash).map((key: string) => [key, lodash[key]])
  );
  return {
    default: lodash,
    ...allMethods,
    sample: vi.fn((...args: any[]) => {
      const [array] = args;
      if(lodash.isEqual(array.sort(), kanjis.sort())){
        return '川';
      }
      return lodash.sample(...args);
    }),
  };
});

vi.mock('../lib/slackUtils');
import wadokaichin from "./index";

vi.useFakeTimers();

let slack: Slack = null;
beforeEach(() => {
  slack = new Slack();
  process.env.CHANNEL_SANDBOX = slack.fakeChannel;
  process.env.CHANNEL_GAMES = slack.fakeChannel;
  wadokaichin(slack);
});

describe('wadokaichin works', () => {
  it('successfully scores problem', async () => {
    {
      const response = await slack.getResponseTo('和同開珎');
      expect('username' in response && response.username).toBe('和同開珎');
      expect(response.text).toContain('arrow_right::question::arrow_right:');
    }
    {
      const response = await slack.waitForResponse();
      expect('username' in response && response.username).toBe('和同開珎');
      expect(response.text).toBe(':question:に入る常用漢字は何でしょう？3分以内に答えてね。');
      expect(response.thread_ts).toBe(slack.fakeTimestamp);
      expect(response.reply_broadcast || false).toBe(false);
    }
    {
      slack.postMessage('山',{thread_ts: slack.fakeTimestamp});
      const {name,timestamp} = await slack.waitForReaction();
      expect(name).toBe('no_good');
      expect(timestamp).toBe(slack.fakeTimestamp);
    }
    {
      const response = await slack.getResponseTo('川',{thread_ts: slack.fakeTimestamp});
      expect('username' in response && response.username).toBe('和同開珎');
      expect(response.text).toBe(`<@${slack.fakeUser}> 『川』正解🎉\n他にも『海/谷』などが当てはまります。`);
      expect(response.thread_ts).toBe(slack.fakeTimestamp);
      expect(response.reply_broadcast).toBe(true);
    }
  });

  it('successfully scores with jukugo', async () => {
    {
      const response = await slack.getResponseTo('わどう');
      expect('username' in response && response.username).toBe('和同開珎');
      expect(response.text).toContain('arrow_right::question::arrow_right:');
    }
    {
      const response = await slack.waitForResponse();
      expect('username' in response && response.username).toBe('和同開珎');
      expect(response.text).toBe(':question:に入る常用漢字は何でしょう？3分以内に答えてね。');
      expect(response.thread_ts).toBe(slack.fakeTimestamp);
      expect(response.reply_broadcast || false).toBe(false);
    }
    {
      const response = await slack.getResponseTo('谷山',{thread_ts: slack.fakeTimestamp});
      expect('username' in response && response.username).toBe('和同開珎');
      expect(response.text).toBe(`<@${slack.fakeUser}> 『谷』正解🎉\n他にも『川/海』などが当てはまります。`);
      expect(response.thread_ts).toBe(slack.fakeTimestamp);
      expect(response.reply_broadcast).toBe(true);
    }
  });

  it('successfully time-ups', async () => {
    {
      const response = await slack.getResponseTo('和同開珎');
      expect('username' in response && response.username).toBe('和同開珎');
      expect(response.text).toContain('arrow_right::question::arrow_right:');
    }
    {
      const response = await slack.waitForResponse();
      expect('username' in response && response.username).toBe('和同開珎');
      expect(response.text).toBe(':question:に入る常用漢字は何でしょう？3分以内に答えてね。');
      expect(response.thread_ts).toBe(slack.fakeTimestamp);
      expect(response.reply_broadcast || false).toBe(false);
    }
    const now = Date.now();
    // XXX: context switchを発生させるために無のawaitをしている。もっとよい書き方がありそう。
    await (new Promise((res) => res(0)));
    // await new Promise(process.nextTick); // これはデッドロックする模様

    vi.spyOn(Date, 'now').mockReturnValue(now + 3*60*1000);
    vi.advanceTimersByTime(1000);
    {
      const response = await slack.waitForResponse();
      expect('username' in response && response.username).toBe('和同開珎');
      expect(response.text).toBe(`時間切れ！\n正解は『川/海/谷』でした。`);
      expect(response.thread_ts).toBe(slack.fakeTimestamp);
      expect(response.reply_broadcast).toBe(true);
    }
  });
});
