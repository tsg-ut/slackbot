import Slack from '../lib/slackMock';
import path from 'path';

jest.mock('../lib/slackUtils');
jest.mock('fs');
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

jest.mock('lodash',() => {
  const orig = jest.requireActual('lodash');
  return {
    ...orig,
    sample: jest.fn((...args) => {
      const [array] = args;
      if(orig.isEqual(array.sort(),kanjis.sort())){
        return '川';
      }
      return orig.sample(...args);
    })
  }
});

import wadokaichin from "./index";

jest.useFakeTimers();

let slack: Slack = null;
beforeEach(() => {
  slack = new Slack();
  process.env.CHANNEL_SANDBOX = slack.fakeChannel;
  wadokaichin(slack);
});

describe('wadokaichin works', () => {
  it('successfully scores problem', async () => {
    {
      const {username,text} = await slack.getResponseTo('和同開珎');
      expect(username).toBe('和同開珎');
      expect(text).toContain('arrow_right::question::arrow_right:');
    }
    {
      const {username,text,thread_ts,reply_broadcast} = await slack.waitForResponse();
      expect(username).toBe('和同開珎');
      expect(text).toBe(':question:に入る常用漢字は何でしょう？3分以内に答えてね。');
      expect(thread_ts).toBe(slack.fakeTimestamp);
      expect(reply_broadcast || false).toBe(false);
    }
    {
      slack.postMessage('山',{thread_ts: slack.fakeTimestamp});
      const {name,timestamp} = await slack.waitForReaction();
      expect(name).toBe('no_good');
      expect(timestamp).toBe(slack.fakeTimestamp);
    }
    {
      const {username,text,thread_ts,reply_broadcast} = await slack.getResponseTo('川',{thread_ts: slack.fakeTimestamp});
      expect(username).toBe('和同開珎');
      expect(text).toBe(`<@${slack.fakeUser}> 『川』正解🎉\n他にも『海/谷』などが当てはまります。`);
      expect(thread_ts).toBe(slack.fakeTimestamp);
      expect(reply_broadcast).toBe(true);
    }
  });

  it('successfully scores with jukugo', async () => {
    {
      const {username,text} = await slack.getResponseTo('わどう');
      expect(username).toBe('和同開珎');
      expect(text).toContain('arrow_right::question::arrow_right:');
    }
    {
      const {username,text,thread_ts,reply_broadcast} = await slack.waitForResponse();
      expect(username).toBe('和同開珎');
      expect(text).toBe(':question:に入る常用漢字は何でしょう？3分以内に答えてね。');
      expect(thread_ts).toBe(slack.fakeTimestamp);
      expect(reply_broadcast || false).toBe(false);
    }
    {
      const {username,text,thread_ts,reply_broadcast} = await slack.getResponseTo('谷山',{thread_ts: slack.fakeTimestamp});
      expect(username).toBe('和同開珎');
      expect(text).toBe(`<@${slack.fakeUser}> 『谷』正解🎉\n他にも『川/海』などが当てはまります。`);
      expect(thread_ts).toBe(slack.fakeTimestamp);
      expect(reply_broadcast).toBe(true);
    }
  });

  it('successfully time-ups', async () => {
    {
      const {username,text} = await slack.getResponseTo('和同開珎');
      expect(username).toBe('和同開珎');
      expect(text).toContain('arrow_right::question::arrow_right:');
    }
    {
      const {username,text,thread_ts,reply_broadcast} = await slack.waitForResponse();
      expect(username).toBe('和同開珎');
      expect(text).toBe(':question:に入る常用漢字は何でしょう？3分以内に答えてね。');
      expect(thread_ts).toBe(slack.fakeTimestamp);
      expect(reply_broadcast || false).toBe(false);
    }
    const now = Date.now();
    // XXX: context switchを発生させるために無のawaitをしている。もっとよい書き方がありそう。
    await (new Promise((res) => res(0)));
    // await new Promise(process.nextTick); // これはデッドロックする模様

    Date.now = jest.fn(() => now + 3*60*1000);
    jest.advanceTimersByTime(1000);
    {
      const {username,text,thread_ts,reply_broadcast} = await slack.waitForResponse();
      expect(username).toBe('和同開珎');
      expect(text).toBe(`時間切れ！\n正解は『川/海/谷』でした。`);
      expect(thread_ts).toBe(slack.fakeTimestamp);
      expect(reply_broadcast).toBe(true);
    }
  });
});
