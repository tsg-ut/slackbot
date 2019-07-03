'use strict';

const image = require('./image.js');
const board = require('./board.js');
const deepcopy = require('deepcopy');
const moment = require('moment');
const querystring = require('querystring');

function getTimeLink(time){
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

module.exports = ({rtmClient: rtm, webClient: slack}) => {
	let state = undefined;

	
	rtm.on('message', async (message) => {
		
		/*
		async function getMemberName(user){
			const {members} = await slack.users.list();
			const member = members.find(({id}) => id === user);
			return member.profile.display_name || member.name;
		};
		*/
		
		function toMention(user){
			return `<@${user}>`;
		}
		
		if (message.channel !== process.env.CHANNEL_SANDBOX) {
			return;
		}
		if (!message.text)return;
		const {text} = message;


		async function postmessage(comment,url){
			//console.log(comment,url);
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
		
		let timeoutId = null;
		
		const beddingminutes = 1;
		const answeringminutes = 1;
		
		async function chainbids(){
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
				state.board.movecommand(state.answer);
				await postmessage(
					`だれも正解できなかったよ:cry:\n正解は ${board.logstringfy(state.answer)} の${state.answer.length}手だよ。`,
					await image.upload(state.board)
				);
				state.board.undocommand(state.answer);
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
			//console.log(state.battles.orderedbids);
			state.battles.firstplayer = true;
			await chainbids();
		}
		
		const restore_state = ((mstate) => {
			if(!mstate){
				return () => {
					state = undefined;
				}
			}
			else{
				const ans = deepcopy(mstate.answer);
				const battles = deepcopy(mstate.battles);
				const ds = mstate.board.dumpstate();
				return () => {
					state.answer = ans;
					state.board.loadstate(ds);
					state.battles = battles;
				}
			}
		})(state);
		
		async function verifycommand(cmd,text){
			state.board.movecommand(cmd);
			const url = await image.upload(state.board);
			if(state.board.iscleared()){
				let comment = "正解です!:tada:";
				if(cmd.length === state.answer.length){
					comment += "さらに最短勝利です!:waiwai:";					
				}
				else if(cmd.length < state.answer.length){
					comment += "というか:bug:ってますね...?????  :satos:に連絡してください。";
				}
				await postmessage(comment,url);
				state.board.undocommand(cmd);
				if(cmd.length > state.answer.length){
					state.board.movecommand(state.answer);
					await postmessage(
						`実は${state.answer.length}手でたどり着けるんです。\n${board.logstringfy(state.answer)}`,
						await image.upload(state.board)
					);
					state.board.undocommand(state.answer);
				}
				else if(board.isMADE(text)){
					state.board.movecommand(state.answer);
					await postmessage(
						`僕の見つけた手順です。\n${board.logstringfy(state.answer)}`,
						await image.upload(state.board)
					);
					state.board.undocommand(state.answer);
				}
				return true;
			}
			else{
				await postmessage("解けてませんね:thinking_face:",url);
				state.board.undocommand(cmd);
				return false;
			}
		}
		
		try{
			if(text === 'ハイパーロボット' || text === 'ハイパーロボットバトル' || text.match(/^ハイパーロボット (\d+)手$/)){
				let depth = undefined;
				{
					let matches = null;
					if ((matches = text.match(/^ハイパーロボット (\d+)手$/))) {
						depth = parseInt(matches[1]);
					}
				}
				const isbattle = (text === 'ハイパーロボットバトル');
				
				const waittime = 10;
				if(!state || (depth && state.answer.length < depth) || (isbattle && !state.battles.isbattle)){
					const [bo,ans] = await board.getBoard(depth);
					state = {
						board: bo,
						answer: ans,
						battles: {
							bids: {},
							isbattle: isbattle,
							isbedding: isbattle,
							startbedding: false,
						},
					};
				}
				//console.log(state);
				await postmessage(`${state.battles.isbattle ? ":question:": state.answer.length}手詰めです`,await image.upload(state.board));
			}
			else if(board.iscommand(text)){
				if(!state){
					await postmessage("まだ出題していませんよ:thinking_face:\nもし問題が欲しければ「ハイパーロボット」と言ってください");
					return;
				}
				
				const cmd = board.str2command(text);
				//console.log(cmd);
				if(state.battles.isbattle){
					if(state.battles.isbedding){
						await postmessage("今は宣言中だよ:cry:");
						return;
					}
					const nowplayer = state.battles.orderedbids[0].user;
					//console.log(message.user,nowplayer);
					if(message.user !== nowplayer){
						await postmessage(`今は${toMention(nowplayer)}さんの解答時間だよ。`);
						return;
					}
					const nowdecl = state.battles.orderedbids[0].decl;
					if(cmd.length > nowdecl){
						await postmessage(`${toMention(nowplayer)}さんの宣言手数は${nowdecl}手だよ:cry:\nその手は${cmd.length}手かかってるよ。`);
						return;
					}
					
					if(await verifycommand(cmd,text)){
						clearTimeout(timeoutId);
						state = undefined;
					}
				}
				else{
					if(await verifycommand(cmd,text)){
						state = undefined;
					}
				}
			}
			else if(state && state.battles.isbattle && state.battles.isbedding && text.match(/^(\d+)手?$/)){
				//console.log(text,message.ts,message.user,(state ? state.battles : ""));
				/*
				if(!state.battles.isbedding){
					await postmessage("今は宣言中じゃないよ");
					return;
				}
				*/
				{
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
		}
		
		catch(e){
			console.log('error',e);
			await postmessage('内部errorです:cry:\n' + String(e));
			restore_state();
		}
	});
};


