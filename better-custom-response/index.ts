import customResponses from './custom-responses';
import {sample, shuffle} from 'lodash';
import {promises as fs} from 'fs';
import path from 'path';
import type {SlackInterface} from '../lib/slack';
// @ts-ignore
import logger from '../lib/logger.js';

const muteListFile = path.resolve(__dirname, 'muteList.txt');

const muteList = async (): Promise<Set<string>> => {
    const listExist = await fs.access(muteListFile)
        .then(() => true)
        .catch(() => false);
    if (!listExist) {
        logger.error(`${muteListFile} not found`);
        return new Set();
    }
    const contents = await fs.readFile(muteListFile, 'utf8');
    return new Set(contents.split('\n'));
};


const response = async (text:string) => {
    const muted: Set<string> = (await muteList()) || new Set();
    for (const resp of customResponses.filter((response) => !response.reaction)) {
        if (muted.has(resp.muteCommand)) continue;
        for (const regexp of resp.input) {
            const matches = text.match(regexp);
            if (matches !== null) {
                const responses = {}.hasOwnProperty.call(resp, 'outputArray') ? resp.outputArray : await resp.outputFunction(matches);
                if (!responses) continue;
                return [resp.shuffle ? shuffle(responses).join('') : sample(responses), resp.username, resp.icon_emoji];
            }
        }
    }
    return [null, null, null];
};


const reaction = async (text:string) => {
    for (const resp of customResponses.filter((response) => response.reaction)) {
        for (const regexp of resp.input) {
            const matches = text.match(regexp);
            if (matches !== null) {
                const responses = {}.hasOwnProperty.call(resp, 'outputArray') ? resp.outputArray : await resp.outputFunction(matches);
                if (!responses) continue;
                return resp.shuffle ? shuffle(responses) : [sample(responses)];
            }
        }
    }
    return null;
};

const mute = async (text: string) => {
  const match = /^@(\w+)\s*:(ohayou|urusee):\s*$/.exec(text);
  if (match == null) return null;
  const response = customResponses.find((response) => response.muteCommand === match[1]);
  if (response == null) return null;
  const muted = await muteList();
  let answer: string;
  if (match[2] === 'urusee') {
      answer = muted.has(response.muteCommand) ? ':kichi:' : ':cry:';
      muted.add(response.muteCommand);
  }
  else {
      answer = muted.has(response.muteCommand) ? ':ohayou:' : ':kichi:';
      muted.delete(response.muteCommand);
  }
  fs.writeFile(muteListFile, Array.from(muted.values()).join('\n'), 'utf8');
  return [answer, response.username, response.icon_emoji];
};

export default async ({rtmClient: rtm, webClient: slack}: SlackInterface) => {
    const defaultTo = (def: string) =>
        (candidate?: string) => candidate == null ? def : candidate;
    const properUsername = defaultTo('better-custom-response');
    const properIcon = defaultTo(':slack:');
    rtm.on('message', async (message) => {
        if (!message.user || message.user.startsWith('B') || message.user === 'UEJTPN6R5' || message.user === 'USLACKBOT') return;
        const {channel, text, ts: timestamp} = message;
        if (!text) return;
        const resp = await response(text);
        if (resp[0]) {
            const username = properUsername(resp[1]);
            const icon_emoji = properIcon(resp[2]);
            await slack.chat.postMessage({
                channel: message.channel,
                text: resp[0],
                username,
                icon_emoji,
            });
        }
        const reac = await reaction(text);
        if (reac) {
            for (const reaction of reac) {
                try {
                    await slack.reactions.add({name: reaction, channel, timestamp});
                } catch (e) {
                    if(e.data.error !== "already_reacted")throw e;
                }
            }
        }
        const mut = await mute(text);
        if (mut != null) {
            const username = properUsername(mut[1]);
            const icon_emoji = properIcon(mut[2]);
            await slack.chat.postMessage({
                channel: message.channel,
                text: mut[0],
                username,
                icon_emoji,
            });
        }
    });
}
