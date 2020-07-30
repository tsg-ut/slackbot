import {times, sample} from 'lodash';
// @ts-ignore
import {$pres, $msg, $iq, Strophe} from 'strophe.js';
// @ts-ignore
import xmldom from 'strophe.js/node_modules/xmldom';
// @ts-ignore
import {XMLHttpRequest} from 'xmlhttprequest';
// @ts-ignore
import logger from '../lib/logger';
import type {SlackInterface} from '../lib/slack';
import {getMemberName} from '../lib/slackUtils';

const getTimestamp = (delayEls: HTMLCollectionOf<Element>) => {
	if (delayEls.length > 0) {
		const delayEl = delayEls.item(0);
		return new Date(delayEl.getAttribute('stamp')).getTime();
	}
	return Date.now();
};

export default ({webClient: slack, rtmClient: rtm}: SlackInterface) => {
	// Insane hacks...
	const parser = new xmldom.DOMParser();
	const doc = parser.parseFromString('<x/>');
	const Element = doc.documentElement.constructor;
	Element.prototype.querySelector = () => null as null;
	// @ts-ignore
	global.window = {XMLHttpRequest};
	// @ts-ignore
	global.XMLHttpRequest = XMLHttpRequest;

	const con = new Strophe.Connection('http://localhost:25252/http-bind?room=sandbox');
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

							if (stamp < connectionTime) {
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

				return true;
			});

			logger.info('jitsi: connected');

			const uid = times(8, () => sample(Array.from('0123456789abcdef'))).join('');

			const pres = $pres({
				to: `sandbox@conference.meet.tsg.ne.jp/${uid}`,
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

			setInterval(async () => {
				const iq = $iq({
					type: 'get',
					to: 'meet.tsg.ne.jp',
				});
				iq.c('ping', {xmlns: 'urn:xmpp:ping'});
				await con.sendIQ(iq, {timeout: 15000});
			}, 10000);
		}
	});

	rtm.on('message', async (message) => {
		const {channel, text, user, subtype} = message;
		if (!text || channel !== process.env.CHANNEL_SANDBOX || subtype !== undefined) {
			return;
		}

		if (text.split('\n').length > 3 || text.length > 100) {
			return;
		}

		const nickname = await getMemberName(user);

		const msg = $msg({
			to: 'sandbox@conference.meet.tsg.ne.jp',
			type: 'groupchat',
		});
		msg.c('body', text).up();
		msg.c('nick', {xmlns: 'http://jabber.org/protocol/nick'}).t(nickname).up().up();
		con.send(msg);
	});
};
