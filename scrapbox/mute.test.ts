import EventEmitter from 'events';
import {MessageAttachment} from '@slack/client';
import {WebClient} from '@slack/web-api';
import {flatten, set, sum} from 'lodash';
import {fastifyDevConstructor} from '../lib/fastify';
// @ts-ignore
import Slack from '../lib/slackMock.js';

const projectName = 'PROJECTNAME';
process.env.SCRAPBOX_PROJECT_NAME = projectName;

// eslint-disable-next-line import/first, import/imports-first, import/order
import {Page, PageInfo} from '../lib/scrapbox';
// eslint-disable-next-line import/first, import/imports-first
import {maskAttachments, reconstructAttachments, server, muteTag, splitAttachments} from './mute';
import { FastifyInstance } from 'fastify';

class FakeAttachmentGenerator {
	i: number = 0;

	j: number = 0;

	get(kind: 'text' | 'img'): MessageAttachment {
		let a: MessageAttachment & { [key: string]: any } | null = null;
		switch (kind) {
			case 'text': {
				const text = `page ${this.i}`;
				a = {
					title: `タイトル ${this.i}`,
					title_link: `https://scrapbox.io/${projectName}/${encodeURIComponent(`タイトル_${this.i}`)}#hash_${this.i}`,
					text,
					rawText: text,
					mrkdwn_in: ['text' as const],
					author_name: `user ${this.i}`,
					image_url: `https://example.com/image_${this.i}.png`,
					thumb_url: `https://example.com/thumb_${this.i}.png`,
				};
				++this.i;
				break;
			}
			case 'img': {
				a = {
					image_url: `https://example.com/image_${this.i}_${this.j}.png`,
				};
				++this.j;
				break;
			}
			default: {
				a = kind;
			}
		}
		return a;
	}

	reset() {
		this.i = 0;
		this.j = 0;
	}
}

const waitEvent = <T>(eventEmitter: EventEmitter, event: string): Promise<T> => new Promise((resolve) => {
	eventEmitter.once(event, (args) => {
		resolve(args);
	});
});

describe('mute notification', () => {
	describe('splitAttachments', () => {
		it('splits attachments to each pages', () => {
			const gen = new FakeAttachmentGenerator();
			const attachments = (['text', 'img', 'img', 'text', 'text', 'img'] as const).map((s) => gen.get(s));
			gen.reset();
			// eslint-disable-next-line array-plural/array-plural
			const expected = [{
				text: gen.get('text'),
				images: [gen.get('img'), gen.get('img')],
			}, {
				text: gen.get('text'),
				images: [],
			}, {
				text: gen.get('text'),
				images: [gen.get('img')],
			}];
			const splittedAttachments = splitAttachments(attachments);
			expect(splittedAttachments).toEqual(expected);
		});
	});

	describe('maskAttachments', () => {
		it('conceals values of notification', () => {
			const gen = new FakeAttachmentGenerator();
			const notification = {
				text: gen.get('text'),
				images: [gen.get('img'), gen.get('img')],
			};
			const attachments = maskAttachments(notification);
			expect(attachments.length).toBe(1);
			const [attachment] = attachments;
			expect(attachment.text).toContain('ミュート');
			const unchanged = ['title', 'title_link', 'mrkdwn_in', 'author_name'] as const;
			const nulled = ['image_url', 'thumb_url'] as const;
			for (const key of unchanged) {
				expect(attachment[key]).toEqual(notification.text[key]);
			}
			for (const key of nulled) {
				expect(attachment[key]).toBeNull();
			}
		});
	});

	describe('reconstructAttachments', () => {
		it('restores original attachment parsed by splitAttachments', () => {
			const gen = new FakeAttachmentGenerator();
			const attachments = [gen.get('text'), gen.get('img'), gen.get('img')];
			const [notification] = splitAttachments(attachments);
			const res = reconstructAttachments(notification);
			expect(res).toEqual(attachments);
		});
	});

	describe('server', () => {
		const fakeChannel = 'CSCRAPBOX';
		let fastify: FastifyInstance | null = null;
		let slack: Slack | null = null;

		beforeAll(() => {
			process.env.CHANNEL_SCRAPBOX = fakeChannel;
		});

		beforeEach(() => {
			slack = new Slack();
			fastify = fastifyDevConstructor();
			fastify.register(server(slack));
		});

		it(`mutes pages with ${muteTag} tag`, async () => {
			// eslint-disable-next-line array-plural/array-plural
			const isMuted = [true, false];
			const fetchInfoSpy = jest.spyOn(Page.prototype, 'fetchInfo').mockImplementation(
				() => Promise.resolve(set(
					{},
					['relatedPages', 'links1hop'],
					isMuted.map((b, i) => ({b, i})).filter(({b}) => b).map(({i}) => ({titleLc: `タイトル_${i}`})),
				) as PageInfo),
				// cast this because it is too demanding to completely write down all properties
			);
			const gen = new FakeAttachmentGenerator();

			const separatedAttachments = [[
				gen.get('text'),
				gen.get('img'),
				gen.get('img'),
			], [
				gen.get('text'),
				gen.get('img'),
			]];

			const args = {
				text: `New lines on <https://scrapbox.io/${projectName}|${projectName}>`,
				mrkdwn: true,
				username: 'Scrapbox',
				attachments: flatten(separatedAttachments),
			};
			const messagePromise = waitEvent<Parameters<WebClient['chat']['postMessage']>[0]>(slack, 'chat.postMessage');
			await fastify.inject({
				method: 'POST',
				url: '/hooks/scrapbox',
				payload: args,
			});

			const {channel, text, attachments: resultAttachment} = await messagePromise;
			expect(channel).toBe(fakeChannel);
			expect(text).toBe(args.text);
			expect(resultAttachment.length).toBe(
				sum(separatedAttachments.map((a, i) => isMuted[i] ? 1 : a.length)),
			);

			fetchInfoSpy!.mockRestore();
		});
	});
});
