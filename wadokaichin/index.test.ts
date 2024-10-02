import Slack from '../lib/slackMock';
import path from 'path';

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
      const response = await slack.getResponseTo('和同開珎');
      expect('username' in response && response.username).toBe('和同開珎');
      expect(response.text).toContain('arrow_right::question::arrow_right:');
    }
    {
      const response = await slack.waitForResponse();
      expect('username' in response && response.username).toBe('和同開珎');
      expect(response.text).toBe(':question:に入る常用漢字は何でしょう？3分以内に答えてね。');
      expect(response.thread_ts).toBe(slack.fakeTimestamp);
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
    }
    {
      const response = await slack.getResponseTo('谷山',{thread_ts: slack.fakeTimestamp});
      expect('username' in response && response.username).toBe('和同開珎');
      expect(response.text).toBe(`<@${slack.fakeUser}> 『谷』正解🎉\n他にも『川/海』などが当てはまります。`);
      expect(response.thread_ts).toBe(slack.fakeTimestamp);
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
    }
    const now = Date.now();
    // XXX: context switchを発生させるために無のawaitをしている。もっとよい書き方がありそう。
    await (new Promise((res) => res(0)));
    // await new Promise(process.nextTick); // これはデッドロックする模様

    Date.now = jest.fn(() => now + 3*60*1000);
    jest.advanceTimersByTime(1000);
    {
      const response = await slack.waitForResponse();
      expect('username' in response && response.username).toBe('和同開珎');
      expect(response.text).toBe(`時間切れ！\n正解は『川/海/谷』でした。`);
      expect(response.thread_ts).toBe(slack.fakeTimestamp);
    }
  });
});
