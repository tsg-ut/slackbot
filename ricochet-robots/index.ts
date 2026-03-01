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
import SinglePlayRicochetRobot from './SinglePlayRicochetRobot';
import { ChannelLimitedBot } from '../lib/channelLimitedBot';
import { Deferred } from '../lib/utils';
import type { GenericMessageEvent } from '@slack/web-api';

interface State {
	board: board.Board,
	answer: board.Move[],
	startDate: number,
	channel: string,
	startMessageTs: string | undefined,
	battles: {
		bids: {[key: string]: {decl: number, time: number}},
		orderedbids?: {user: string, decl: number, time: number}[],
		isbattle: boolean,
		isbedding: boolean,
		startbedding: boolean,
		firstplayer?: boolean,
	},
}

function getTimeLink(time: number) {
	const text = moment(time).utcOffset('+0900').format('HH:mm:ss');
	const url = `https://www.timeanddate.com/countdown/generic?${querystring.stringify({
		iso: moment(time).utcOffset('+0900').format('YYYYMMDDTHHmmss'),
		p0: 248,
		msg: '宣言終了まで',
		font: 'sansserif',
		csz: 1,
	})}`;
	return `<${url}|${text}>`;
}

function toMention(user: string) {
	return `<@${user}>`;
}

const beddingminutes = 1;
const answeringminutes = 1;

class RicochetRobotsBot extends ChannelLimitedBot {
	protected override readonly wakeWordRegex = /^(ベイビー|スーパー|ハイパー)ロボット( \d+手|バトル)?$/;
	protected override readonly username = 'hyperrobot';
	protected override readonly iconEmoji = ':robot_face:';

	private state: State | undefined = undefined;
	private singlePlayRicochetRobot: SinglePlayRicochetRobot | undefined = undefined;
	private readonly mutex = new Mutex();
	private battleTimeoutId: NodeJS.Timeout | null = null;

	constructor(slackClients: SlackInterface) {
		super(slackClients);
		this.eventClient.on('message', this.onBattleMessage.bind(this));
	}

	private async postGameMessage(comment: string, url?: string) {
		if (!this.state) return;
		const channel = this.state.channel;
		if (!url) {
			await this.postMessage({ channel, text: comment });
		} else {
			await this.postMessage({
				channel,
				text: comment,
				attachments: [{ image_url: url, fallback: '' }],
			});
		}
	}

	private async chainBids() {
		if (!this.state) return;
		if (!this.state.battles.firstplayer) {
			await this.postGameMessage(`${toMention(this.state.battles.orderedbids[0].user)}さんは間に合わなかったみたいだね。残念:cry:`);
			this.state.battles.orderedbids.shift();
		}
		this.state.battles.firstplayer = false;

		if (this.state.battles.orderedbids.length > 0) {
			const nextbid = this.state.battles.orderedbids[0];
			const endtime = Date.now() + answeringminutes * 60 * 1000;
			await this.postGameMessage(`${toMention(nextbid.user)}さんの解答ターンだよ。\n${nextbid.decl}手以下の手順を${getTimeLink(endtime)}までに解答してね。`);
			this.battleTimeoutId = setTimeout(() => this.chainBids(), answeringminutes * 60 * 1000);
		} else {
			const answerBoard = this.state.board.clone();
			answerBoard.movecommand(this.state.answer);
			const imageData = await image.upload(answerBoard);
			await this.postGameMessage(
				`だれも正解できなかったよ:cry:\n正解は ${board.logstringfy(this.state.answer)} の${this.state.answer.length}手だよ。`,
				imageData.secure_url
			);
			const startMessageTs = this.state.startMessageTs;
			this.state = undefined;
			if (startMessageTs !== undefined) {
				await this.deleteProgressMessage(startMessageTs);
			}
		}
	}

	private async onEndBedding() {
		if (!this.state) return;
		this.state.battles.isbedding = false;
		this.state.battles.orderedbids = [];
		for (const k in this.state.battles.bids) {
			this.state.battles.orderedbids.push({
				user: k,
				decl: this.state.battles.bids[k].decl,
				time: this.state.battles.bids[k].time,
			});
		}
		this.state.battles.orderedbids.sort((a, b) => (a.decl !== b.decl ? (a.decl - b.decl) : (a.time - b.time)));
		this.state.battles.bids = {};
		this.state.battles.firstplayer = true;
		await this.chainBids();
	}

	private async verifyCommand(cmd: board.Command, user: string) {
		if (!this.state) return false;
		if (!this.state.battles.isbattle && !cmd.isMADE && cmd.moves.length > this.state.answer.length) {
			await this.postGameMessage(
				`この問題は${this.state.answer.length}手詰めだよ。その手は${cmd.moves.length}手かかってるよ:thinking_face:\n` +
				'もし最短でなくてもよいなら、手順のあとに「まで」をつけてね。'
			);
			return false;
		}
		const playerBoard = this.state.board.clone();
		playerBoard.movecommand(cmd.moves);
		const imageData = await image.upload(playerBoard);
		if (playerBoard.iscleared()) {
			let comment = "正解です!:tada:";
			if (cmd.moves.length === this.state.answer.length) {
				comment += "さらに最短勝利です!:waiwai:";
			} else if (cmd.moves.length < this.state.answer.length) {
				comment += "というか:bug:ってますね...?????  :satos:に連絡してください。";
				await unlock(user, 'ricochet-robots-debugger');
			}
			await this.postGameMessage(comment, imageData.secure_url);

			const botcomment = (cmd.moves.length > this.state.answer.length) ?
				`実は${this.state.answer.length}手でたどり着けるんです。\n${board.logstringfy(this.state.answer)}` :
				`僕の見つけた手順です。\n${board.logstringfy(this.state.answer)}`;

			const botBoard = this.state.board.clone();
			botBoard.movecommand(this.state.answer);
			const botBoardImageData = await image.upload(botBoard);
			await this.postGameMessage(botcomment, botBoardImageData.secure_url);

			if (cmd.moves.length <= this.state.answer.length) {
				await unlock(user, 'ricochet-robots-clear-shortest');
				if (this.state.answer.length >= 10) {
					await unlock(user, 'ricochet-robots-clear-shortest-over10');
				}
				if (this.state.answer.length >= 15) {
					await unlock(user, 'ricochet-robots-clear-shortest-over15');
				}
				if (this.state.answer.length >= 20) {
					await unlock(user, 'ricochet-robots-clear-shortest-over20');
				}
			}
			return true;
		} else {
			await this.postGameMessage("解けてませんね:thinking_face:", imageData.secure_url);
			return false;
		}
	}

	protected override onWakeWord(message: GenericMessageEvent, channel: string): Promise<string | null> {
		const quizMessageDeferred = new Deferred<string | null>();

		this.mutex.runExclusive(async () => {
			const text = message.text!;
			let matches: RegExpMatchArray | null = null;

			try {
				if ((matches = text.match(/^(ベイビー|スーパー|ハイパー)ロボット( (\d+)手)?$/))) {
					if (this.singlePlayRicochetRobot) {
						await this.singlePlayRicochetRobot.repostProblemMessage();
						quizMessageDeferred.resolve(null);
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

					const singlePlayRicochetRobot = await SinglePlayRicochetRobot.init({
						slackClients: this.slackClients,
						channel,
						depth,
						size: difficulty.size,
						numOfWalls: difficulty.numOfWalls,
						threadTs: message.ts,
						originalUser: message.user,
					});

					this.singlePlayRicochetRobot = singlePlayRicochetRobot;

					singlePlayRicochetRobot.start({
						mode: 'normal',
						onStarted(startMessage) {
							quizMessageDeferred.resolve(startMessage.ts!);
						},
					}).then(async (result) => {
						this.singlePlayRicochetRobot = undefined;
						const gameTs = await quizMessageDeferred.promise;
						if (gameTs !== null) {
							await this.deleteProgressMessage(gameTs);
						}
						this.log.info(result);
					}).catch((e: unknown) => {
						this.log.error(e);
						this.singlePlayRicochetRobot = undefined;
						quizMessageDeferred.resolve(null);
					});
				} else if (text.match(/^(ベイビー|スーパー|ハイパー)ロボットバトル?$/)) {
					// TODO: バトルでない場合の処理を削除
					const isbattle = text.match(/^(ベイビー|スーパー|ハイパー)ロボットバトル$/);

					const difficulty = {
						"ベイビー": {size: {h: 3, w: 5}, numOfWalls: 3},
						"スーパー": {size: {h: 5, w: 7}, numOfWalls: 10},
						"ハイパー": {size: {h: 7, w: 9}, numOfWalls: 15},
					}[text.match(/^(ベイビー|スーパー|ハイパー)/)[0]];

					if (!this.state) {
						const [bo, ans] = await board.getBoard({depth: 1000, ...difficulty});
						this.state = {
							board: bo,
							answer: ans,
							startDate: Date.now(),
							channel,
							startMessageTs: undefined,
							battles: {
								bids: {},
								isbattle: Boolean(isbattle),
								isbedding: Boolean(isbattle),
								startbedding: false,
							},
						};
					}
					const imageData = await image.upload(this.state.board);
					const response = await this.postMessage({
						channel,
						text: `${this.state.battles.isbattle ? ":question:" : this.state.answer.length}手詰めです`,
						attachments: [{image_url: imageData.secure_url, fallback: ''}],
					});
					this.state.startMessageTs = response.ts ?? undefined;
					quizMessageDeferred.resolve(response.ts ?? null);

					if (isbattle) {
						await unlock(message.user, 'ricochet-robots-buttle-play');
					} else {
						await unlock(message.user, 'ricochet-robots-play');
					}
				} else {
					quizMessageDeferred.resolve(null);
				}
			} catch (e) {
				this.log.error(e);
				await this.postMessage({channel, text: '内部errorです:cry:\n' + String(e)});
				await unlock(message.user, 'ricochet-robots-debugger');
				quizMessageDeferred.resolve(null);
			}
		}).catch((e: unknown) => {
			this.log.error(e);
			quizMessageDeferred.resolve(null);
		});

		return quizMessageDeferred.promise;
	}

	private async onBattleMessage(messageEvent: MessageEvent) {
		const message = extractMessage(messageEvent);
		if (!message || !message.text || !message.user) return;
		if (!this.state) return;
		if (message.channel !== this.state.channel) return;

		const {text} = message;

		this.mutex.runExclusive(async () => {
			try {
				if (message.thread_ts === undefined && board.iscommand(text)) {
					if (!this.state) {
						await this.postGameMessage("まだ出題していませんよ:thinking_face:\nもし問題が欲しければ「ハイパーロボット」と言ってください");
						return;
					}

					const cmd = board.str2command(text);
					if (this.state.battles.isbattle) {
						if (this.state.battles.isbedding) {
							await this.postGameMessage("今は宣言中だよ:cry:");
							return;
						}
						const nowplayer = this.state.battles.orderedbids[0].user;
						if (message.user !== nowplayer) {
							await this.postGameMessage(`今は${toMention(nowplayer)}さんの解答時間だよ。`);
							return;
						}
						const nowdecl = this.state.battles.orderedbids[0].decl;
						if (cmd.moves.length > nowdecl) {
							await this.postGameMessage(`${toMention(nowplayer)}さんの宣言手数は${nowdecl}手だよ:cry:\nその手は${cmd.moves.length}手かかってるよ。`);
							return;
						}

						if (await this.verifyCommand(cmd, message.user)) {
							const startMessageTs = this.state.startMessageTs;
							this.state = undefined;
							clearTimeout(this.battleTimeoutId);
							await unlock(message.user, 'ricochet-robots-buttle-win');
							if (startMessageTs !== undefined) {
								await this.deleteProgressMessage(startMessageTs);
							}
						}
					} else {
						const passedMs = Date.now() - this.state.startDate;
						if (await this.verifyCommand(cmd, message.user)) {
							const answerLength = this.state.answer.length;
							await this.postGameMessage(`経過時間: ${round(passedMs / 1000, 3)} 秒`);
							const startMessageTs = this.state.startMessageTs;
							this.state = undefined;
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
							if (startMessageTs !== undefined) {
								await this.deleteProgressMessage(startMessageTs);
							}
						}
					}
				} else if (this.state && this.state.battles.isbattle && this.state.battles.isbedding && text.match(/^(\d+)手?$/)) {
					let bid = 100;
					let matches;
					if (matches = text.match(/^(\d+)手?$/)) {
						bid = parseInt(matches[1]);
					}
					const time = parseFloat(message.ts);
					if (!(message.user in this.state.battles.bids) || this.state.battles.bids[message.user].time < time) {
						this.state.battles.bids[message.user] = {
							decl: bid,
							time: time,
						};
					}
					await this.slack.reactions.add({name: 'ok_hand', channel: message.channel, timestamp: message.ts});

					if (!this.state.battles.startbedding) {
						this.state.battles.startbedding = true;
						setTimeout(() => this.onEndBedding(), beddingminutes * 60 * 1000);
						const endtime = Date.now() + beddingminutes * 60 * 1000;
						await this.postGameMessage(`宣言終了予定時刻: ${getTimeLink(endtime)}`);
					}
				}
			} catch (e) {
				this.log.error(e);
				await this.postGameMessage('内部errorです:cry:\n' + String(e));
				await unlock(message.user, 'ricochet-robots-debugger');
			}
		});
	}
}

export default function ricochetRobots(slackClients: SlackInterface) {
	return new RicochetRobotsBot(slackClients);
}

