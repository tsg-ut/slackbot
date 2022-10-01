import wordle_battle from './index';
// @ts-expect-error
import Slack from '../lib/slackMock.js';

let slack: Slack = null;

beforeEach(async () => {
    slack = new Slack();
    process.env.CHANNEL_SANDBOX = slack.fakeChannel;
    await wordle_battle(slack);
});

describe('wordle battle', () => {
    it('respond to wordle battle', async () => {
        const { channel, text }: { channel: string, text: string } = await slack.getResponseTo('wordle battle');

        expect(channel).toBe(slack.fakeChannel);
        expect(text).toContain('Wordle Battle を開始します！');
    });
    
    it('respond to wordle battle 10', async () => {
        const { channel, text }: { channel: string, text: string } = await slack.getResponseTo('wordle battle 10');

        expect(channel).toBe(slack.fakeChannel);
        expect(text).toContain('Wordle Battle を開始します！');
    });
    
    it('respond to wordle battle 100', async () => {
        const { channel, text }: { channel: string, text: string } = await slack.getResponseTo('wordle battle 100');

        expect(channel).toBe(slack.fakeChannel);
        expect(text).toContain('単語のみに対応しています。');
    });

    it('respond to wordle reset', async () => {
        const { channel, text }: { channel: string, text: string } = await slack.getResponseTo('wordle reset');

        expect(channel).toBe(slack.fakeChannel);
        expect(text).toContain('Wordle Battle をリセットしました。');
    });
});
