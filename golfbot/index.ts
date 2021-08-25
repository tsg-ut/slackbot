import {Mutex} from 'async-mutex';
import {stripIndent} from 'common-tags';
import moment from 'moment';
import {SlackInterface} from '../lib/slack';
import logger from '../lib/logger';
import * as views from './views';

const USERNAME = 'golfbot';
const ICON_EMOJI = ':golf:';

const mutex = new Mutex();

type ParseResult =
	| {
			type: 'none';
	  }
	| {
			type: 'error';
			message: string;
			subcommand?: string;
	  }
	| {
			type: 'help';
			subcommand?: string;
	  }
	| {
			type: 'join';
			service: string;
			username: string;
	  }
	| {
			type: 'post';
	  };

const parseMessage = (text: string): ParseResult | null => {
	let re: RegExp;
	let match: RegExpMatchArray | null;

	// call
	re = /^@golfbot\b\s*/;
	match = re.exec(text);
	if (!match) return null;
	text = text.replace(re, '');

	// subcommand
	re = /^(?<subcommand>[a-z0-9-]+)\b\s*/i;
	match = re.exec(text);
	if (!match) return {type: 'none'};
	const {subcommand} = match.groups!;
	text = text.replace(re, '');

	switch (subcommand) {
		case 'join': {
			re = /^(?<service>atcoder)\s+(?<username>[a-z0-9-]+)\s*$/i;
			match = re.exec(text);
			if (!match) {
				return {type: 'error', message: `引数がおかしいよ`, subcommand: 'join'};
			}
			const {service, username} = match.groups!;
			return {type: 'join', service, username};
		}
		case 'post': {
			return {type: 'post'};
		}
		case 'help': {
			re = /^(?<subcommand>[a-z0-9-]+)\s*$/i;
			match = re.exec(text);
			if (!match) {
				return {type: 'help'};
			}
			const {subcommand} = match.groups!;
			return {type: 'help', subcommand};
		}
		default: {
			return {type: 'error', message: `「${subcommand}」は知らないコマンドだよ`};
		}
	}
};

const help = (subcommand?: string): string => {
	switch (subcommand) {
		case 'join': {
			return stripIndent`
				\`join\` : アカウント登録

				\`\`\`
				@golfbot join atcoder <username>
				\`\`\`
			`;
		}
		case 'post': {
			return stripIndent`
				\`post\` : 問題投稿

				\`\`\`
				@golfbot post
				\`\`\`

				ダイアログが開くので、問題 URL、開始日時、終了日時を入力してね！
			`;
		}
		default: {
			return stripIndent`
				\`join\` : アカウント登録
				\`post\` : 問題投稿

				詳しい使い方は \`@golfbot help <subcommand>\` で聞いてね！
			`;
		}
	}
};

export default ({rtmClient: rtm, webClient: slack, messageClient: slackInteractions}: SlackInterface) => {
	slackInteractions.action(
		{
			blockId: 'golfbot_post',
			actionId: 'post',
		},
		(payload: any) => {
			mutex.runExclusive(() => {
				slack.views.open({
					trigger_id: payload.trigger_id,
					view: views.createPostView(),
				});
			});
		}
	);

	slackInteractions.viewSubmission(
		{
			callbackId: 'golfbot_post',
		},
		(payload: any) => {
			const values = views.getPostValues(payload.view.state.values);

			logger.info(`[golfbot] post ${JSON.stringify(values)}`);

			const now = moment();
			const today = now.format('YYYY-MM-DD');
			if (values.date < today) {
				return {
					response_action: 'errors',
					errors: {
						golfbot_post_date: '過去の日付は選べないよ',
					},
				};
			}

			const startAt = moment(`${values.date} ${values.startTime}`);
			const endAt = moment(`${values.date} ${values.endTime}`);
			if (startAt < now) {
				return {
					response_action: 'errors',
					errors: {
						golfbot_post_start_time: '開始時刻は過去にできないよ',
					},
				};
			}

			if (startAt >= endAt) {
				return {
					response_action: 'errors',
					errors: {
						golfbot_post_end_time: '終了時刻は開始時刻より後にしてね',
					},
				};
			}

			mutex.runExclusive(async () => {
				// TODO
			});

			return {
				response_action: 'clear',
			};
		}
	);

	rtm.on('message', async (message: any) => {
		const cmd = parseMessage(message.text);
		if (cmd === null) {
			return;
		}

		logger.info(`[golfbot] command ${JSON.stringify(cmd)}`);

		switch (cmd.type) {
			case 'join': {
				return;
			}
			case 'post': {
				await slack.chat.postMessage({
					channel: message.channel,
					text: '',
					blocks: views.createPostBlocks(),
					username: USERNAME,
					icon_emoji: ICON_EMOJI,
				});
				return;
			}
			case 'help': {
				await slack.chat.postMessage({
					channel: message.channel,
					text: help(cmd.subcommand),
					username: USERNAME,
					icon_emoji: ICON_EMOJI,
				});
				return;
			}
			case 'error': {
				await slack.chat.postMessage({
					channel: message.channel,
					text: cmd.message + '\n---\n' + help(cmd.subcommand),
					username: USERNAME,
					icon_emoji: ICON_EMOJI,
				});
				return;
			}
			case 'none': {
				await slack.chat.postMessage({
					channel: message.channel,
					text: help(),
					username: USERNAME,
					icon_emoji: ICON_EMOJI,
				});
				return;
			}
		}
	});
};
