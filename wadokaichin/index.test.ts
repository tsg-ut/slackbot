// @ts-expect-error
import Slack from '../lib/slackMock.js';
import path from 'path';

jest.mock('fs');
import fs from 'fs';

const kanjis = [ '山', '川', '谷', '海' ];
const dicts = Array.from({length:2}).fill([
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
    let ts = null;
    {
      const {username,thread_ts,text} = await slack.getResponseTo('和同開珎');
      ts = thread_ts;
      expect(username).toBe('和同開珎');
      expect(text).toContain('arrow_right::question::arrow_right:');
    }
    {
      const {username,text,thread_ts,reply_broadcast} = await slack.getResponse();
      expect(username).toBe('和同開珎');
      expect(text).toBe(':question:に共通して入る常用漢字は何でしょう？3分以内に答えてね。');
      expect(thread_ts).toBe(ts);
      expect(reply_broadcast || false).toBe(false);
    }
    {
      slack.postMessage('山',{thread_ts: ts});
      const {name,timestamp} = await slack.getReactionAdd();
      expect(name).toBe('no_good');
      expect(timestamp).toBe(slack.fakeTimestamp);
    }
    {
      const {username,text,thread_ts,reply_broadcast} = await slack.getResponseTo('川',{thread_ts: ts});
      expect(username).toBe('和同開珎');
      expect(text).toBe(`<@${slack.fakeUser}> 『川』正解🎉\n他にも海/谷などが当てはまります。`);
      expect(thread_ts).toBe(ts);
      expect(reply_broadcast).toBe(true);
    }
  });

  it('successfully time-ups', async () => {
    let ts = null;
    {
      const {username,thread_ts,text} = await slack.getResponseTo('和同開珎');
      ts = thread_ts;
      expect(username).toBe('和同開珎');
      expect(text).toContain('arrow_right::question::arrow_right:');
    }
    {
      const {username,text,thread_ts,reply_broadcast} = await slack.getResponse();
      expect(username).toBe('和同開珎');
      expect(text).toBe(':question:に共通して入る常用漢字は何でしょう？3分以内に答えてね。');
      expect(thread_ts).toBe(ts);
      expect(reply_broadcast || false).toBe(false);
    }
    jest.advanceTimersByTime(3*60*1000);
    {
      const {username,text,thread_ts,reply_broadcast} = await slack.getResponse();
      expect(username).toBe('和同開珎');
      expect(text).toBe(`時間切れ！\n正解は『川/海/谷』でした。`);
      expect(thread_ts).toBe(ts);
      expect(reply_broadcast).toBe(true);
    }
  });
});

