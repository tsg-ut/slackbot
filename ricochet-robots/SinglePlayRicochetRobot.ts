import { AteQuiz, AteQuizProblem } from '../atequiz';
import { round } from 'lodash';
import cloudinary from 'cloudinary';
import type { Message } from '@slack/web-api/dist/response/ConversationsHistoryResponse';
import { SlackInterface } from '../lib/slack';
import * as image from './image';
import * as board from './board';
import { ChatPostMessageArguments, KnownBlock } from '@slack/web-api';
import { unlock } from '../achievements';
import assert from 'assert';
import { stripIndent } from 'common-tags';
import type { GenericMessageEvent } from '@slack/bolt';

interface SingleRicochetRobotConstructor {
	slackClients: SlackInterface,
	channel: string,
	depth: number,
	size: {h: number, w: number},
	numOfWalls: number,
	threadTs: string,
	originalUser: string,
}

export default class SinglePlayRicochetRobot extends AteQuiz {
	startTime: number;
	endTime: number;
	boardData: board.Board;
	answer: board.Move[];
	originalUser: string;

	constructor(
		slackClients: SlackInterface,
		problem: AteQuizProblem,
		boardData: board.Board,
		answer: board.Move[],
		originalUser: string,
	) {
		super(slackClients, problem, {
			username: 'hyperrobot',
			icon_emoji: ':robot_face:',
		});
		this.boardData = boardData;
		this.answer = answer;
		this.originalUser = originalUser;
	}

	static async init({slackClients, channel, depth, size, numOfWalls, threadTs, originalUser}: SingleRicochetRobotConstructor) {
		const [boardData, answer] = await board.getBoard({depth, size, numOfWalls});
		const imageData = await image.upload(boardData);
		const quizText = `${answer.length}手詰めです`;

		const thumbnailUrl = cloudinary.v2.url(`${imageData.public_id}.jpg`, {
			private_cdn: false,
			secure: true,
			secure_distribution: 'res.cloudinary.com',
			background: 'white',
			width: 400,
			height: 400,
			crop: 'pad',
		});

		const singleRicochetRobot = new SinglePlayRicochetRobot(slackClients, {
			problemMessage: {
				channel,
				text: quizText,
				blocks: [
					{
						type: 'section',
						text: {
							type: 'plain_text',
							text: quizText,
						},
						accessory: {
							type: 'image',
							image_url: thumbnailUrl,
							alt_text: 'ハイパーロボット',
						},
					},
				],
				thread_ts: threadTs,
				reply_broadcast: true,
			},
			hintMessages: [],
			immediateMessage: {
				channel,
				text: 'このスレッドに回答してね！',
				blocks: [
					{
						type: 'section',
						text: {
							type: 'plain_text',
							text: 'このスレッドに回答してね！',
						},
					},
					{
						type: 'image',
						image_url: imageData.secure_url,
						alt_text: 'ハイパーロボット',
					},
				],
			},
			solvedMessage: {
				channel,
				text: '',
				reply_broadcast: true,
			},
			unsolvedMessage: {
				channel,
				text: '',
				reply_broadcast: true,
			},
			correctAnswers: [],
		}, boardData, answer, originalUser);

		return singleRicochetRobot;
	}

	waitSecGen() {
		return Infinity;
	}

	start() {
		this.startTime = Date.now();
		return super.start();
	}

	postMessage(message: Partial<ChatPostMessageArguments>) {
		return this.slack.chat.postMessage({
			...message,
			channel: this.problem.problemMessage.channel,
			thread_ts: this.problem.problemMessage.thread_ts,
			username: 'hyperrobot',
			icon_emoji: ':robot_face:',
		});
	}

	async postNotSolvedMessage(board: board.Board) {
		const message = '解けてませんね:thinking_face:';
		const imageData = await image.upload(board);
		await this.postMessage({
			text: message,
			blocks: [
				{
					type: 'section',
					text: {
						type: 'plain_text',
						text: '解けてませんね:thinking_face:',
					},
				},
				{
					type: 'image',
					image_url: imageData.secure_url,
					alt_text: '結果',
				},
			],
		});
	}

	judge(answer: string) {
		if (board.iscommand(answer)) {
			const command = board.str2command(answer);
			if (!command.isMADE && command.moves.length > this.answer.length) {
				this.postMessage({
					text: stripIndent`
						この問題は${this.answer.length}手詰めだよ。その手は${command.moves.length}手かかってるよ:thinking_face:
						もし最短でなくてもよいなら、手順のあとに「まで」をつけてね。
					`,
				});
				return false;
			}
			const playerBoard = this.boardData.clone(); 
			playerBoard.movecommand(command.moves);
			if (playerBoard.iscleared()) {
				this.endTime = Date.now();
				return true;
			}
			this.postNotSolvedMessage(playerBoard);
			return false;
		}
		return false;
	}

	async solvedMessageGen(message: GenericMessageEvent) {
		const answer = message.text as string;
		assert(board.iscommand(answer), 'answer is not command');

		const command = board.str2command(answer);
		const playerBoard = this.boardData.clone(); 
		playerBoard.movecommand(command.moves);
		assert(playerBoard.iscleared(), 'playerBoard is not cleared');

		let comment = '正解です!:tada:';
		if (command.moves.length === this.answer.length) {
			comment += 'さらに最短勝利です!:waiwai:';
		}

		return {
			channel: this.problem.solvedMessage.channel,
			text: comment,
			reply_broadcast: true,
		};
	}

	async answerMessageGen(message: GenericMessageEvent) {
		const answer = message.text as string;
		assert(board.iscommand(answer), 'answer is not command');

		const command = board.str2command(answer);
		const playerBoard = this.boardData.clone(); 
		playerBoard.movecommand(command.moves);
		assert(playerBoard.iscleared(), 'playerBoard is not cleared');

		const blocks: KnownBlock[] = [];

		const durationSeconds = (this.endTime - this.startTime) / 1000;

		let comment = '';
		if (command.moves.length < this.answer.length){
			comment += 'というか:bug:ってますね...????? :hakatashi:に連絡してください。';
			await unlock(message.user, 'ricochet-robots-debugger');
		}

		const playerBoardImageData = await image.upload(playerBoard);

		if (comment.length > 0) {
			blocks.push({
				type: 'section',
				text: {
					type: 'mrkdwn',
					text: comment,
				},
			});
		}

		blocks.push({
			type: 'image',
			image_url: playerBoardImageData.secure_url,
			alt_text: 'プレイヤーの回答',
		});
		
		const botcomment = (command.moves.length > this.answer.length) ?
													`実は${this.answer.length}手でたどり着けるんです。\n${board.logstringfy(this.answer)}`:
													`僕の見つけた手順です。\n${board.logstringfy(this.answer)}`;
		
		const botBoard = this.boardData.clone();
		botBoard.movecommand(this.answer);
		const botBoardImageData = await image.upload(botBoard);

		blocks.push(
			{
				type: 'section',
				text: {
					type: 'mrkdwn',
					text: botcomment,
				},
			},
			{
				type: 'image',
				image_url: botBoardImageData.url,
				alt_text: '想定回答',
			},
			{
				type: 'section',
				text: {
					type: 'mrkdwn',
					text: `経過時間: ${round(durationSeconds, 3)} 秒`,
				},
			}
		);
		
		if(command.moves.length <= this.answer.length){
			await unlock(message.user, 'ricochet-robots-clear-shortest');
			if (this.answer.length >= 10) {
				await unlock(message.user, 'ricochet-robots-clear-shortest-over10');
			}
			if (this.answer.length >= 15) {
				await unlock(message.user, 'ricochet-robots-clear-shortest-over15');
			}
			if (this.answer.length >= 20) {
				await unlock(message.user, 'ricochet-robots-clear-shortest-over20');
			}
		}
		await unlock(message.user, 'ricochet-robots-clear');
		if (this.answer.length >= 8 && command.moves.length <= this.answer.length) {
			if (durationSeconds <= this.answer.length * 10) {
				await unlock(message.user, 'ricochet-robots-clear-in-10sec-per-move-over8');
			}
			if (durationSeconds <= this.answer.length * 5) {
				await unlock(message.user, 'ricochet-robots-clear-in-5sec-per-move-over8');
			}
			if (durationSeconds <= this.answer.length * 1) {
				await unlock(message.user, 'ricochet-robots-clear-in-1sec-per-move-over8');
			}
		}

		return {
			channel: this.problem.solvedMessage.channel,
			text: comment,
			blocks,
		};
	}
}