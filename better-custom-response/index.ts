import customResponses from './custom-responses';
import {sample, shuffle} from 'lodash';
import {promises as fs} from 'fs';
import path from 'path';
import type {SlackInterface} from '../lib/slack';
// @ts-ignore
import logger from '../lib/logger.js';

const muteListFile = path.resolve(__dirname, 'muteList.json');

const muteList = async (): Promise<Map<string, Set<string>>> => {
    const listExist = await fs.access(muteListFile)
        .then(() => true)
        .catch(() => false);
    if (!listExist) {
        logger.error(`${muteListFile} not found`);
        return new Map()
    }
    const contents = await fs.readFile(muteListFile, 'utf8');
    return new Map(
        Object.entries(JSON.parse(contents))
            .map(([user, mutes]: [string, string[]]) => [user, new Set(mutes)])
    );
};


const response = async (text:string, user: string) => {
    const muted: Set<string> = (await muteList()).get(user) || new Set();
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

const mute = async (text: string, user: string) => {
  const match = /^@(\w+)\s*:(ohayou|urusee):\s*$/.exec(text);
  if (match == null) return null;
  const response = customResponses.find((response) => response.muteCommand === match[1]);
  if (response == null) return null;
  const muted = await muteList();
  const responses: Set<string> = muted.get(user) || new Set();
  let answer: string;
  if (match[2] === 'urusee') {
      answer = responses.has(response.muteCommand) ? ':kichi:' : ':cry:';
      responses.add(response.muteCommand);
  }
  else {
      answer = responses.has(response.muteCommand) ? ':ohayou:' : ':kichi:';
      responses.delete(response.muteCommand);
  }
  muted.set(user, responses);
  const converted = Object.fromEntries(
      Array.from(muted.entries(), ([user, reactions]) => [user, Array.from(reactions.values())])
  );
  fs.writeFile(muteListFile, JSON.stringify(converted), 'utf8');
  return [answer, response.username, response.icon_emoji];
};

export default async ({rtmClient: rtm, webClient: slack}: SlackInterface) => {
    const defaultTo = (def: string) =>
        (candidate?: string) => candidate == null ? def : candidate;
    const properUsername = defaultTo('better-custom-response');
    const properIcon = defaultTo(':slack:');
    rtm.on('message', async (message) => {
        if (!message.user || message.user.startsWith('B') || message.user === 'UEJTPN6R5' || message.user === 'USLACKBOT') return;
        const {channel, text, user, ts: timestamp} = message;
        if (!text) return;
        const resp = await response(text, user);
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
        const mut = await mute(text, user);
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
