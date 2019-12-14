import {RTMClient, WebClient} from '@slack/client';
// @ts-ignore
import logger from '../lib/logger.js';
import {promisify} from 'util';
import {EmojiData} from 'emoji-data-ts';
import {getEmoji} from '../lib/slackUtils';
import axios from 'axios';
import * as sharp from 'sharp';
// @ts-ignore
import {v2 as cloudinary} from 'cloudinary';

const emojiData = new EmojiData();
let team_id: string = null;

const downloadImage = async (url: string): Promise<Buffer> =>
  await axios.get(
    url,
    { responseType: 'arraybuffer' })
  .then((response) => Buffer.from(response.data));

const retrieveEmoji = async (name: string): Promise<Buffer> => {
	const emojiURL = await getEmoji(name, team_id);
	if (emojiURL !== undefined) {
		return await downloadImage(emojiURL);
	}
	const defaultEmoji = emojiData.getImageData(name);
	if (defaultEmoji) {
		const url = `https://raw.githubusercontent.com/iamcal/emoji-data/master/img-apple-64/${defaultEmoji.imageUrl}`;
    return await downloadImage(url);
	}
	return null;
};

const uploadImage = async (image: Buffer): Promise<string> => {
  const response = await new Promise((resolve, reject) => {
    cloudinary.uploader.upload_stream((error: any, data: any) => {
      if (error) reject(error);
      else resolve(data);
    }).end(image);
  });
  // @ts-ignore
  return response.secure_url;
};



interface SlackInterface {
    rtmClient: RTMClient;
    webClient: WebClient;
}

export default async ({rtmClient: rtm, webClient: slack}: SlackInterface) => {
  const {team}: any = await slack.team.info();
  team_id = team.id;/*
  const emojiImage = async (name: string) => {
    const emojiURL = await getEmojiImageUrl(name, team.id);
    if (emojiURL === null) return null;
    return download(emojiURL);
  }; */
  const postMessage = (text: string): void => {
    slack.chat.postMessage({
      channel: process.env.CHANNEL_SANDBOX,
      text,
      username: 'emoji-modifier',
      icon_emoji: ':uouo-fish-life:',
    });
  };
  rtm.on('message', async message => {
    if (message.channel !== process.env.CHANNEL_SANDBOX)
      return;

    const match= /^:([^!:\s]+):$/.exec(message.text);
    if (match === null)
      return;

    const image = await retrieveEmoji(match[1]);
    if (image !== null) {
      const url = await uploadImage(image);
      logger.info(url);
      postMessage(url);
    }
  });
}
