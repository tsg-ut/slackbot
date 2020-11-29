import type {WebClient} from '@slack/web-api';
import {times, sample} from 'lodash';
// @ts-ignore
import {$pres, $msg, $iq, Strophe} from 'strophe.js';
import xmldom from 'xmldom';
// @ts-ignore
import {XMLHttpRequest} from 'xmlhttprequest';
// @ts-ignore
import logger from '../lib/logger';
import type {SlackInterface} from '../lib/slack';
import {getMemberName} from '../lib/slackUtils';

interface JoinParameters {
	jid: string,
	nick: string,
	avatarId: string,
	roomId: string
}

interface LeaveParameters {
	jid: string,
	roomId: string
}

const configuredRooms = ['sb', 'workroom', 'recital'];

const getTimestamp = (delayEls: HTMLCollectionOf<Element>) => {
	if (delayEls.length > 0) {
		const delayEl = delayEls.item(0);
		return new Date(delayEl.getAttribute('stamp')).getTime();
	}
	return Date.now();
};

const connect = (
	slack: WebClient,
	roomName: string,
	onJoin: (params: JoinParameters) => void,
	onLeave: (params: LeaveParameters) => void,
) => {
	let intervalId: NodeJS.Timer = null;

	const con = new Strophe.Connection(`http://localhost:25252/http-bind?room=${roomName}`);
	con.connect('meet.tsg.ne.jp', '', (status: number) => {
		const connectionTime = Date.now();

		if (status === Strophe.Status.CONNECTED) {
			con.addHandler((data: Element) => {
				try {
					if (data.tagName === 'message') {
						const bodyEls = data.getElementsByTagName('body');
						const nickEls = data.getElementsByTagName('nick');
						const delayEls = data.getElementsByTagName('delay');

						if (bodyEls.length > 0 && nickEls.length > 0) {
							const body = bodyEls.item(0).firstChild.nodeValue;
							const nick = nickEls.item(0).firstChild.nodeValue;
							const stamp = getTimestamp(delayEls);

							if (stamp < connectionTime || nick === 'slackbot') {
								return true;
							}

							slack.chat.postMessage({
								channel: process.env.CHANNEL_SANDBOX,
								username: nick,
								icon_emoji: ':jitsi:',
								text: body,
							});
						}
					}
				} catch (e) {
					logger.error(e);
				}

				try {
					if (data.tagName === 'presence') {
						const itemEls = data.getElementsByTagName('item');
						const nickEls = data.getElementsByTagName('nick');
						const avatarIdEls = data.getElementsByTagName('avatar-id');
						const type = data.getAttribute('type');
						const [roomId] = data.getAttribute('from').split('@');

						if (type === '' && itemEls.length > 0 && nickEls.length > 0) {
							const nick = nickEls.item(0).firstChild.nodeValue;
							const avatarId = avatarIdEls.item(0).firstChild.nodeValue;
							const jid = itemEls.item(0).getAttribute('jid');
							onJoin({jid, nick, roomId, avatarId});
						}

						if (type === 'unavailable' && itemEls.length > 0) {
							const jid = itemEls.item(0).getAttribute('jid');
							onLeave({jid, roomId});
						}
					}
				} catch (e) {
					logger.error(e);
				}

				return true;
			});

			logger.info('jitsi: connected');

			const uid = times(8, () => sample(Array.from('0123456789abcdef'))).join('');

			const pres = $pres({
				to: `${roomName}@conference.meet.tsg.ne.jp/${uid}`,
			});
			pres.c('x', {
				xmlns: 'http://jabber.org/protocol/muc',
			}).up();
			pres.c('stats-id').t('Kaley-PHS').up();
			pres.c('c', {
				xmlns: 'http://jabber.org/protocol/caps',
				hash: 'sha-1',
				node: 'http://jitsi.org/jitsimeet',
				ver: 'cvjWXufsg4xT62Ec2mlATkFZ9lk=',
			}).up();
			pres.c('avatar-id').t('75ee51a5bb8b4c155b8bbf2533c7deb4').up();
			pres.c('nick', {
				xmlns: 'http://jabber.org/protocol/nick',
			}).t('slackbot').up();
			pres.c('audiomuted', {
				xmlns: 'http://jitsi.org/jitmeet/audio',
			}).t('true').up();
			pres.c('videoType', {
				xmlns: 'http://jitsi.org/jitmeet/video',
			}).t('camera').up();
			pres.c('videomuted', {
				xmlns: 'http://jitsi.org/jitmeet/video',
			}).t('true').up();
			pres.up();
			con.send(pres);

			intervalId = setInterval(async () => {
				const iq = $iq({
					type: 'get',
					to: 'meet.tsg.ne.jp',
				});
				iq.c('ping', {xmlns: 'urn:xmpp:ping'});
				await con.sendIQ(iq, {timeout: 15000});
			}, 10000);
		}
	});

	const disconnect = () => {
		clearInterval(intervalId);
		con.disconnect('relaunch');
	};

	const postChat = (nickname: string, text: string) => {
		const msg = $msg({
			to: `${roomName}@conference.meet.tsg.ne.jp`,
			type: 'groupchat',
		});
		msg.c('body', `${nickname}: ${text}`).up();
		msg.c('nick', {xmlns: 'http://jabber.org/protocol/nick'}).t('slackbot').up().up();
		con.send(msg);
	};

	return {
		disconnect,
		postChat,
	};
};

export default ({webClient: slack, rtmClient: rtm}: SlackInterface) => {
	// Insane hacks...
	const parser = new xmldom.DOMParser();
	const doc = parser.parseFromString('<x/>');
	const Element = doc.documentElement.constructor;
	Element.prototype.querySelector = () => null as null;
	// @ts-ignore
	global.XMLHttpRequest = XMLHttpRequest;

	for (const roomName of configuredRooms) {
		const members: Map<string, {nick: string, avatarId: string}> = new Map();

		const onJoin = ({jid, nick, avatarId, roomId}: JoinParameters) => {
			if (!members.has(jid) && nick !== 'slackbot') {
				members.set(jid, {nick, avatarId});
				slack.chat.postMessage({
					channel: process.env.CHANNEL_SANDBOX,
					username: 'jitsi',
					icon_emoji: ':jitsi-join:',
					text: `＊${nick}＊が<https://meet.tsg.ne.jp/${roomId}|${roomId}>にログインしました\n現在のアクティブ人数 ${members.size}人`,
				});
			}
		};

		const onLeave = ({jid, roomId}: LeaveParameters) => {
			if (members.has(jid)) {
				const {nick} = members.get(jid);
				members.delete(jid);

				slack.chat.postMessage({
					channel: process.env.CHANNEL_SANDBOX,
					username: 'jitsi',
					icon_emoji: ':jitsi-leave:',
					text: `＊${nick}＊が<https://meet.tsg.ne.jp/${roomId}|${roomId}>からログアウトしました\n現在のアクティブ人数 ${members.size}人`,
				});
			}
		};

		let {disconnect, postChat} = connect(slack, roomName, onJoin, onLeave);
		setInterval(() => {
			disconnect();
			setTimeout(() => {
				const config = connect(slack, roomName, onJoin, onLeave);
				disconnect = config.disconnect;
				postChat = config.postChat;
			}, 5000);
		}, 30 * 60 * 1000);

		rtm.on('message', async (message) => {
			const {channel, text, user, subtype, thread_ts} = message;
			if (!text || channel !== process.env.CHANNEL_SANDBOX || subtype !== undefined || thread_ts !== undefined) {
				return;
			}

			if (text.split('\n').length > 3 || text.length > 100) {
				return;
			}

			const nickname = await getMemberName(user);
			postChat(nickname, text);
		});
	}
};
