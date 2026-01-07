import ahokusa from './index';
import Slack from '../lib/slackMock';
import { jest } from '@jest/globals';

jest.mock('../achievements');
jest.mock('../lib/slackUtils');

let slack: Slack;
let postMessageMock: jest.Mock;

beforeEach(() => {
    slack = new Slack();
    postMessageMock = jest.fn().mockResolvedValue({ ok: true, ts: slack.fakeTimestamp });
    slack.registeredMocks.set('chat.postMessage', postMessageMock);

    process.env.CHANNEL_SANDBOX = slack.fakeChannel;
    process.env.CHANNEL_GAMES = slack.fakeChannel;
    ahokusa(slack);
});

describe('ahokusa', () => {
    const postMessage = (text: string) => {
        slack.eventClient.emit('message', {
            type: 'message',
            channel: slack.fakeChannel,
            user: slack.fakeUser,
            text,
            ts: slack.fakeTimestamp,
        });
    };

    it('responds to あほくさスライドパズル', async () => {
        postMessage('あほくさスライドパズル');
        await new Promise(setImmediate);

        const call = postMessageMock.mock.calls[0][0] as any;
        expect(call.username).toBe('ahokusa');
        expect(call.text).toContain(':void:');
        expect(call.text).toMatch(/^(:[a-z-]+:){3}\n(:[a-z-]+:){3}$/);
    });

    it('accepts valid board initialization by emojis', async () => {
        const board = [
            ':void::ahokusa-bottom-center::ahokusa-top-center:',
            ':ahokusa-bottom-left::ahokusa-top-left::ahokusa-top-right:',
        ].join('\n');
        postMessage(`@ahokusa ${board}`);
        await new Promise(setImmediate);

        const call = postMessageMock.mock.calls[0][0] as any;
        expect(call.username).toBe('ahokusa');
        expect(call.text).toBe(board);
    });

    it('accepts valid board initialization by letters', async () => {
        postMessage('@ahokusa .#_さくあ');
        await new Promise(setImmediate);

        const call = postMessageMock.mock.calls[0][0] as any;
        expect(call.username).toBe('ahokusa');
        expect(call.text).toBe(
            [
                ':void::ahokusa-bottom-center::ahokusa-top-center:',
                ':ahokusa-bottom-left::ahokusa-top-left::ahokusa-top-right:',
            ].join('\n')
        );
    });

    it('rejects invalid board initialization with invalid characters', async () => {
        postMessage('@ahokusa ああああああ');
        await new Promise(setImmediate);

        const call = postMessageMock.mock.calls[0][0] as any;
        expect(call.username).toBe('ahokusa');
        expect(call.text).toBe(':ha:');
    });

    it('rejects invalid board initialization with too many characters', async () => {
        postMessage(
            '@ahokusa .#_さくああああああああああああああああああああ'
        );
        await new Promise(setImmediate);

        const call = postMessageMock.mock.calls[0][0] as any;
        expect(call.username).toBe('ahokusa');
        expect(call.text).toBe(':ha:');
    });

    it('responds to 寿司スライドパズル', async () => {
        postMessage('寿司スライドパズル');
        await new Promise(setImmediate);

        const call = postMessageMock.mock.calls[0][0] as any;
        expect(call.username).toBe('sushi-puzzle');
        expect(call.text).toContain(':void:');
        expect(call.text).toContain('sushi');
        expect(call.text).toMatch(/^(:[a-z_\d-]+:(\n|$))+$/);
    });
});
