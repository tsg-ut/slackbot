'use strict';

import * as image from './image';
import * as board from './board';
import moment from 'moment';
import querystring from 'querystring';
import { Mutex } from 'async-mutex';
import { unlock } from '../achievements';
import { round } from 'lodash';
import type { SlackInterface } from '../lib/slack.js';
import type { MessageEvent } from '@slack/bolt';
import { extractMessage } from '../lib/slackUtils';
import logger from '../lib/logger';
import SinglePlayRicochetRobot from './SinglePlayRicochetRobot';

const log = logger.child({ bot: 'ricochet-robots' });

interface State {
	board: board.Board,
	answer: board.Move[],
	startDate: number,
	battles: {
		bids: {[key: string]: {decl: number, time: number}},
		orderedbids?: {user: string, decl: number, time: number}[],
		isbattle: boolean,
		isbedding: boolean,
		startbedding: boolean,
		firstplayer?: boolean,
	},
}

function getTimeLink(time: number){
	const text = moment(time).utcOffset('+0900').format('HH:mm:ss');
	const url = `https://www.timeanddate.com/countdown/generic?${querystring.stringify({
		iso: moment(time).utcOffset('+0900').format('YYYYMMDDTHHmmss'),
		p0: 248,
		msg: '宣言終了まで',
		font: 'sansserif',
		csz: 1,
	})}`;
	return `<${url}|${text}>`;
};

export default (slackClients: SlackInterface) => {
	const { eventClient, webClient: slack } = slackClients;
	let state: State | undefined = undefined;
	let singlePlayRicochetRobot: SinglePlayRicochetRobot | undefined = undefined;
	const mutex = new Mutex();
	
	eventClient.on('message', async (messageEvent: MessageEvent) => {
		const message = extractMessage(messageEvent);

		function toMention(user: string){
			return `<@${user}>`;
		}
		
		if (message.channel !== process.env.CHANNEL_SANDBOX) {
			return;
		}
		if (!message.text)return;
		const {text, channel} = message;

		async function postmessage(comment: string,url?: string){
			if(!url){
				await slack.chat.postMessage({
						channel: process.env.CHANNEL_SANDBOX,
						text: comment,
						username: 'hyperrobot',
						icon_emoji: ':robot_face:',
				});
			}
			else{
				await slack.chat.postMessage({
						channel: process.env.CHANNEL_SANDBOX,
						text: comment,
						username: 'hyperrobot',
						icon_emoji: ':robot_face:',
						attachments: [{
								image_url: url,
								fallback: '',
						}],
				});
			}
		}
		
		let timeoutId: NodeJS.Timeout | null = null;
		
		const beddingminutes = 1;
		const answeringminutes = 1;
		
		async function chainbids(){
			if(!state)return;
			if(!state.battles.firstplayer){
				await postmessage(`${toMention(state.battles.orderedbids[0].user)}さんは間に合わなかったみたいだね。残念:cry:`);
				state.battles.orderedbids.shift();
			}
			state.battles.firstplayer = false;
			
			if(state.battles.orderedbids.length > 0){
				const nextbid = state.battles.orderedbids[0];
				const endtime = Date.now() + answeringminutes * 60 * 1000;
				await postmessage(`${toMention(nextbid.user)}さんの解答ターンだよ。\n${nextbid.decl}手以下の手順を${getTimeLink(endtime)}までに解答してね。`);
				timeoutId = setTimeout(chainbids, answeringminutes * 60 * 1000);
			}
			else{
				const answerBoard = state.board.clone();
				answerBoard.movecommand(state.answer);
				const imageData = await image.upload(answerBoard);
				await postmessage(
					`だれも正解できなかったよ:cry:\n正解は ${board.logstringfy(state.answer)} の${state.answer.length}手だよ。`,
					imageData.secure_url
				);
				state = undefined;
			}
		}
		
		async function onEndBedding(){
			state.battles.isbedding = false;
			state.battles.orderedbids　= [];
			for(const k in state.battles.bids){
				state.battles.orderedbids.push({
					user: k,
					decl: state.battles.bids[k].decl,
					time: state.battles.bids[k].time,
				});
			}
			state.battles.orderedbids.sort((a,b) => (a.decl !== b.decl ? (a.decl-b.decl) : (a.time-b.time)));
			state.battles.bids = {};
			state.battles.firstplayer = true;
			await chainbids();
		}
		
		async function verifycommand(cmd: board.Command){
			if(!state.battles.isbattle && !cmd.isMADE && cmd.moves.length > state.answer.length){
				await postmessage(
					`この問題は${state.answer.length}手詰めだよ。その手は${cmd.moves.length}手かかってるよ:thinking_face:\n` +
					'もし最短でなくてもよいなら、手順のあとに「まで」をつけてね。'
				);
				return false;
			}
			const playerBoard = state.board.clone(); 
			playerBoard.movecommand(cmd.moves);
			const imageData = await image.upload(playerBoard);
			if(playerBoard.iscleared()){
				let comment = "正解です!:tada:";
				if(cmd.moves.length === state.answer.length){
					comment += "さらに最短勝利です!:waiwai:";					
				}
				else if(cmd.moves.length < state.answer.length){
					comment += "というか:bug:ってますね...?????  :satos:に連絡してください。";
					await unlock(message.user, 'ricochet-robots-debugger');
				}
				await postmessage(comment,imageData.secure_url);
				
				const botcomment = (cmd.moves.length > state.answer.length) ?
				                     `実は${state.answer.length}手でたどり着けるんです。\n${board.logstringfy(state.answer)}`:
				                     `僕の見つけた手順です。\n${board.logstringfy(state.answer)}`;
				
				const botBoard = state.board.clone();
				botBoard.movecommand(state.answer);
				const botBoardImageData = await image.upload(botBoard);
				await postmessage(botcomment, botBoardImageData.secure_url);
				
				if(cmd.moves.length <= state.answer.length){
					await unlock(message.user, 'ricochet-robots-clear-shortest');
					if(state.answer.length >= 10){
						await unlock(message.user, 'ricochet-robots-clear-shortest-over10');
					}
					if(state.answer.length >= 15){
						await unlock(message.user, 'ricochet-robots-clear-shortest-over15');
					}
					if(state.answer.length >= 20){
						await unlock(message.user, 'ricochet-robots-clear-shortest-over20');
					}
				}
				return true;
			}
			else{
				await postmessage("解けてませんね:thinking_face:",imageData.secure_url);
				return false;
			}
		}
		
		mutex.runExclusive(async () => {
			try {
				let matches: RegExpMatchArray | null = null;
				if((matches = text.match(/^(ベイビー|スーパー|ハイパー)ロボット( (\d+)手)?$/))){
					if (singlePlayRicochetRobot) {
						await singlePlayRicochetRobot.repostProblemMessage();
						return;
					}

					let depth: number = parseInt(matches[2]);
					if (Number.isNaN(depth)) {
						depth = 1000;
					} else if (depth >= 1000) {
						depth = 1000;
					} else if (depth <= 0) {
						depth = 1;
					}

					const difficulty = {
						"ベイビー": {size: {h: 3, w: 5}, numOfWalls: 3},
						"スーパー": {size: {h: 5, w: 7}, numOfWalls: 10},
						"ハイパー": {size: {h: 7, w: 9}, numOfWalls: 15},
					}[text.match(/^(ベイビー|スーパー|ハイパー)/)[0]];

					singlePlayRicochetRobot = await SinglePlayRicochetRobot.init({
						slackClients,
						channel: channel,
						depth: depth,
						size: difficulty.size,
						numOfWalls: difficulty.numOfWalls,
						threadTs: message.ts,
						originalUser: message.user,
					})

					singlePlayRicochetRobot.start().then((result) => {
						singlePlayRicochetRobot = undefined;
						log.info(result);
					});
				}
			} catch (e) {
				log.error(e);
				await postmessage('内部errorです:cry:\n' + String(e));
				await unlock(message.user, 'ricochet-robots-debugger');
			}

			// TODO: バトルでない場合の処理を削除
			try{
				if(text.match(/^(ベイビー|スーパー|ハイパー)ロボットバトル?$/)){
					let depth = undefined;
					{
						let matches = null;
						if ((matches = text.match(/^(ベイビー|スーパー|ハイパー)ロボット (\d+)手$/))) {
							depth = parseInt(matches[2]);
							if(depth >= 1000)depth = 1000;
							else if(depth<=0)depth = 1;
						}
					}
					const isbattle = text.match(/^(ベイビー|スーパー|ハイパー)ロボットバトル$/);
					
					const difficulty = {
						"ベイビー": {size: {h: 3, w: 5}, numOfWalls: 3},
						"スーパー": {size: {h: 5, w: 7}, numOfWalls: 10},
						"ハイパー": {size: {h: 7, w: 9}, numOfWalls: 15},
					}[text.match(/^(ベイビー|スーパー|ハイパー)/)[0]];
					
					if(!state){
						const [bo,ans] = await board.getBoard({depth: (depth || 1000) , ...difficulty});
						state = {
							board: bo,
							answer: ans,
							startDate: Date.now(),
							battles: {
								bids: {},
								isbattle: Boolean(isbattle),
								isbedding: Boolean(isbattle),
								startbedding: false,
							},
						};
					}
					const imageData = await image.upload(state.board);
					await postmessage(`${state.battles.isbattle ? ":question:": state.answer.length}手詰めです`,imageData.secure_url);
					if(isbattle){
						await unlock(message.user, 'ricochet-robots-buttle-play');
					}
					else{
						await unlock(message.user, 'ricochet-robots-play');
					}
				}
				else if(message.thread_ts === undefined && board.iscommand(text)){
					if(!state){
						await postmessage("まだ出題していませんよ:thinking_face:\nもし問題が欲しければ「ハイパーロボット」と言ってください");
						return;
					}
					
					const cmd = board.str2command(text);
					if(state.battles.isbattle){
						if(state.battles.isbedding){
							await postmessage("今は宣言中だよ:cry:");
							return;
						}
						const nowplayer = state.battles.orderedbids[0].user;
						if(message.user !== nowplayer){
							await postmessage(`今は${toMention(nowplayer)}さんの解答時間だよ。`);
							return;
						}
						const nowdecl = state.battles.orderedbids[0].decl;
						if(cmd.moves.length > nowdecl){
							await postmessage(`${toMention(nowplayer)}さんの宣言手数は${nowdecl}手だよ:cry:\nその手は${cmd.moves.length}手かかってるよ。`);
							return;
						}
						
						if(await verifycommand(cmd)){
							state = undefined;
							clearTimeout(timeoutId);
							await unlock(message.user, 'ricochet-robots-buttle-win');
						}
					}
					else{
						const passedMs = Date.now() - state.startDate;
						if(await verifycommand(cmd)){
							const answerLength = state.answer.length;
							await postmessage(`経過時間: ${round(passedMs / 1000, 3)} 秒`);
							state = undefined;
							await unlock(message.user, 'ricochet-robots-clear');
							if (answerLength >= 8 && cmd.moves.length <= answerLength) {
								if (passedMs <= answerLength * 10 * 1000) {
									await unlock(message.user, 'ricochet-robots-clear-in-10sec-per-move-over8');
								}
								if (passedMs <= answerLength * 5 * 1000) {
									await unlock(message.user, 'ricochet-robots-clear-in-5sec-per-move-over8');
								}
								if (passedMs <= answerLength * 1 * 1000) {
									await unlock(message.user, 'ricochet-robots-clear-in-1sec-per-move-over8');
								}
							}
						}
					}
				}
				else if(state && state.battles.isbattle && state.battles.isbedding && text.match(/^(\d+)手?$/)){
					let bid = 100;
					let matches;
					if(matches = text.match(/^(\d+)手?$/)) {
						bid = parseInt(matches[1]);
					}
					const time = parseFloat(message.ts)
					if(!(message.user in state.battles.bids) || state.battles.bids[message.user].time < time){
						state.battles.bids[message.user] = {
							decl: bid,
							time: time,
						};
					}
					await slack.reactions.add({name: 'ok_hand', channel: message.channel, timestamp: message.ts});
						
					if(!state.battles.startbedding){
						state.battles.startbedding = true;
						setTimeout(onEndBedding, beddingminutes * 60 * 1000);
						const endtime = Date.now() + beddingminutes * 60 * 1000;
						await postmessage(`宣言終了予定時刻: ${getTimeLink(endtime)}`);
					}
				}
			}
			catch(e){
				log.error(e);
				await postmessage('内部errorです:cry:\n' + String(e));
				await unlock(message.user, 'ricochet-robots-debugger');
			}
		});
	});
};


