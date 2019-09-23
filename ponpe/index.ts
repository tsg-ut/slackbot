import {WebClient, RTMClient} from '@slack/client';
import moment from 'moment';
import axios from 'axios';
// @ts-ignore
import hiraganize from 'japanese';
import sample from 'lodash/sample';
import fs from 'fs';
import {getMemberName} from '../lib/slackUtils';

interface SlackInterface {
	rtmClient: RTMClient,
	webClient: WebClient,
}

function getTimeLink(time:number){
	return moment(time).utcOffset('+0900').format('HH:mm:ss');
}


async function getHardTheme(){
	const header = await axios.head('https://www.weblio.jp/WeblioRandomSelectServlet');
	//スペース(+) どうにかする
	return decodeURI(header.request.path.split('/')[2]);
}


interface Hint{
	data: string,
	cost: number,
	time: number,
	user: string,
}

interface Theme{
	word: string,
	ruby: string,
}

interface State{
	answer: Theme,
	registerend: number,
	registants: string[],
	hints: Hint[],
	threadId: string | null,
	timeoutId: ReturnType<typeof setTimeout> | null,
	hintuser: string | null,
	answering: boolean
}

export default async ({rtmClient: rtm, webClient: slack}: SlackInterface) => {
	const states : State[] = [];
	const default_emoji_list = 
		(await axios.get('https://raw.githubusercontent.com/iamcal/emoji-data/master/emoji.json'))
		.data.map((x:{short_names:string})=>{return x.short_names;}).flat();
	const custom_emoji_list = Object.keys((await slack.emoji.list({token: process.env.HAKATASHI_TOKEN})).emoji);
	const emoji_list = default_emoji_list + custom_emoji_list;
	
	//cat BCCWJ_frequencylist_luw_ver1_0.tsv | grep "名詞" | grep -v "人名" | grep -v "数詞" 
	//    | head -n 50000 | tail -n 10000 | awk '{ print $2 "," $3 }' > common_word_list
	const themes = String(fs.readFileSync('../wiki_dataset/common_word_list')).split('\n');

	function getTheme(){
		const theme = sample(themes).split(',');
		return {
			word: theme[1],
			ruby: hiraganize(theme[0]),
		};
	}
	
	rtm.on('message', async (message) => {
		if(message.type !== 'message' || message.subtype === 'message_replied'){
			return;
		}
		async function reply(msg:string):Promise<any>{
			return await slack.chat.postMessage({
				channel: message.channel,
				text: msg,
			});
		}
		
		const answertime = 3 * 60 * 1000;
		const registertime = 5 * 60 * 1000;
		async function chainbids(){
			if(states[0].hints.length > 0){
				const endtime = Date.now() + answertime;
				const hint = states[0].hints[0];
				const msg = await reply(`${hint.data}\n${hint.user}さんのヒントだよ。${getTimeLink(endtime)}までにこのメッセージへのスレッドとしてひらがなで解答してね。文字数は${states[0].answer.ruby.length}文字だよ。もしこのヒントでわからずに諦める場合は「ギブアップ」と解答してね。`);
				states[0].threadId = msg.ts;
				states[0].timeoutId = setTimeout(chainbids, answertime);
				states[0].hintuser = hint.user;
			}
			else{
				await reply(`だれも正解できなかったよ:cry:。正解は「${states[0].answer.ruby}」だよ。`);
				states.shift();
			}
			states[0].hints.shift();
		}
		if(message.channel.startsWith('D') && message.text === 'ぽんぺお題'){
			if(states.length <= 0){
				await reply(`まだ開始されていないよ。#sandboxで「ぽんぺ出題」と発言してね。`);
				return;
			}
			if(states[0].answering){
				await reply(`今は回答中だよ`);
				return;				
			}
			await reply(`今の登録中のお題は「${states.slice(-1)[0].answer.ruby}」だよ！`);
			states.slice(-1)[0].registants.push(message.user);
		}
		if(message.channel.startsWith('D') && message.text.startsWith('ぽんぺ登録')){
			if(states.length <= 0){
				await reply(`まだ開始されていないよ。#sandboxで「ぽんぺ出題」と発言してね。`);
				return;
			}
			if(states[0].answering){
				await reply(`今は回答中だよ`);
				return;				
			}
			const ponpe = message.text.split('\n').slice(1).map((x:string)=>{return x.replace(/\s/gi,'');}).join('\n');
			if(!ponpe.match(/^(:[^:\s]+:\s*)*$/)){
				await reply('emojiのみからなる文字列を登録してください');
				return;
			}
				
			let emoji_count = 0;
			for (let matchArray, re = /:([^:\s]+):\s*/g; (matchArray = re.exec(ponpe));) {
				const name = matchArray[1];
				if(!emoji_list.includes(name)){
					await reply(`:${name}:はemojiとして登録されていないよ:cry:`);
					return;
				}
				if(!['void','white'].includes(name)){
					emoji_count += 1;
				}
			}
			
			const user = await getMemberName(message.user);
			states.slice(-1)[0].hints = states.slice(-1)[0].hints.filter((x)=>{
				return x.user !== user;
			});
			
			states.slice(-1)[0].hints.push({
				data: ponpe,
				cost: emoji_count,
				time: Date.now(),
				user: user,
			});
			await reply(`お題「${states.slice(-1)[0].answer.ruby}」に対してコスト${emoji_count}のぽんぺが登録されたよ:tada:`);
			states.slice(-1)[0].registants.push(message.user);
			
			await slack.chat.postMessage({
				channel: process.env.CHANNEL_SANDBOX,
				text: `${user}さんがぽんぺに登録したよ。`,
			});
		}
		if(message.channel === process.env.CHANNEL_SANDBOX){
			if(states.length > 0 && states[0].threadId !== null && message.thread_ts === states[0].threadId){
				if(message.text === 'ギブアップ'){
					await slack.chat.postMessage({
						channel: message.channel,
						text: 'ギブアップしたよ:cry:',
						thread_ts: states[0].threadId,
					});
					clearTimeout(states[0].timeoutId);
					states[0].timeoutId = setTimeout(chainbids, Date.now());
					return;
				}
				if(states[0].registants.includes(message.user)){
					await slack.chat.postMessage({
						channel: message.channel,
						text: '答えを知ってるひとが答えちゃだめだよ:imp:',
						thread_ts: states[0].threadId,
					});
				}
				else if(message.text === states[0].answer.ruby){
					await slack.reactions.add({
						name: 'tada',
						channel: message.channel,
						timestamp: message.ts,
					});
					await reply(`${await getMemberName(message.user)}さんが${states[0].hintuser}さんのヒントで「${message.text}」を正解したよ！:tada:`);
					clearTimeout(states[0].timeoutId);
					states.shift();
				}
				else{
					await slack.reactions.add({
						name: 'thinking_face',
						channel: message.channel,
						timestamp: message.ts,
					});
				}
			}
			
			if(message.text === 'ぽんぺ出題'){
				if(states.length > 0 && Date.now() <= states[0].registerend){
					await reply(`ぽんぺはすでに始まってるよ。${getTimeLink(states[0].registerend)}までに登録してね。`);
					return;
				}
				states.unshift({
					answer: await getTheme(),
					registerend: Date.now() + registertime,
					registants: [],
					hints: [],
					threadId: null,
					timeoutId: null,
					hintuser: null,
					answering: false,
				});
				await reply(`ぽんぺをはじめるよ:waiwai:。`);
				await reply(`DMで「ぽんぺお題」というとお題を知ることができるよ。`);
				await reply(`DMで「ぽんぺ登録」の次の行にお題を伝えられるようなemoji列を描いて登録してね。voidでないemojiが少ないほど偉いよ。`);
				await reply(`以下は、"寿司職人"というお題に対する登録例だよ`);
				await reply(`\nぽんぺ登録\n:sushi-clockwise-top-left::sushi-go-right::sushi-clockwise-top-right:\n:sushi-go-up::male-cook::sushi-go-down:\n:sushi-clockwise-bottom-left::sushi-go-left::sushi-clockwise-bottom-right:`);
				await reply(`${getTimeLink(states[0].registerend)}以降にここで「ぽんぺ回答」というと、回答フェイズに移行するよ。`);
			}
			if(message.text === 'ぽんぺ回答'){
				if(states.length > 0 && Date.now() <= states[0].registerend){
					await reply(`ぽんぺはまだ出題中だよ。${getTimeLink(states[0].registerend)}までに登録してね。`);
					return;
				}
				else if(states.length > 0 && states[0].answering){
					await reply(`既にぽんぺ回答中だよ。`);
					return;
				}
				await reply(`ぽんぺの回答を始めるよ。`);
				states[0].answering = true;
				states[0].hints.sort((x,y)=>{
					if(x.cost !== y.cost)return x.cost - y.cost;
					return x.time - y.time;
				});
				await chainbids();
			}
		}
	});
}

