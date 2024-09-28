import qs from 'querystring';
import { Mutex } from 'async-mutex';
import { sample } from 'lodash';
import { increment } from '../achievements';
import { AteQuiz, typicalMessageTextsGenerator } from '../atequiz';
import { SlackInterface } from '../lib/slack';
import { prefectures } from '../room-gacha/prefectures';

const mutex = new Mutex();

interface CitySymbol {
	prefectureName: string;
	cityName: string;
	reason: string;
	date: string;
	notes: string;
	files: string[];
}

const getWikipediaSource = async (prefName: string) => {
	const title = `${prefName}の${prefName === '東京都' ? '区' : ''}市町村章一覧`;
	console.log(`Getting wikipedia ${title}...`);
	const url = `https://ja.wikipedia.org/w/api.php?${qs.encode({
		format: 'json',
		action: 'query',
		prop: 'revisions',
		rvprop: 'content',
		titles: title,
	})}`;

	const response = await fetch(url);
	const json = await response.json();

	const pages = json?.query?.pages;
	const content = pages?.[Object.keys(pages)[0]]?.revisions?.[0]?.['*'];
	if (!content) {
		throw new Error('Failed to get wikipedia source');
	}

	const lines = content.split('\n');
	const citySymbols: CitySymbol[] = [];

	for (const line of lines) {
		if (line.startsWith('=') && line.includes('廃止された')) {
			break;
		}

		const normalizedLine = line
			.replaceAll(/<ref[^/>]*>.*?<\/ref>/g, '')
			.replaceAll(/<ref[^>]*\/>/g, '')
			.replaceAll(/\[\[File:[^\]]+\]\]/g, '')
			.replaceAll(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
			.replaceAll(/\[\[([^\]]+)\]\]/g, '$1')
			.replaceAll(/^\|/g, '')
			.replaceAll(/\{\{.*?\}\}/g, '')
			.trim();
		const files = line.matchAll(/\[\[File:([^\]|]+)(:?\|[^\]]+)?\]\]/g);

		if (!normalizedLine.includes('||')) {
			continue;
		}

		const columns = normalizedLine.split('||');
		if (columns.length < 5) {
			continue;
		}

		const [cityName, , reason, date, notes] = columns.slice(-5);

		citySymbols.push({
			prefectureName: prefName,
			cityName: cityName.trim(),
			reason: reason.trim(),
			date: date.trim(),
			notes: notes.trim().replaceAll(/<br \/>/g, '\n'),
			files: [...files].map(([, file]) => file),
		});
	}

	return citySymbols;
};

const getRandomCitySymbol = async () => {
	const prefectureChosen = sample(Object.keys(prefectures));
	const citySymbols = await getWikipediaSource(prefectureChosen);
	return sample(citySymbols);
};

const getWikimediaImageUrl = (fileName: string) => `https://commons.wikimedia.org/wiki/Special:FilePath/${qs.escape(fileName)}?width=200`;

class CitySymbolAteQuiz extends AteQuiz {
	waitSecGen(): number {
		return 30;
	}
}

export default async (slackClients: SlackInterface) => {
	const { eventClient } = slackClients;

	eventClient.on('message', (message) => {
		if (message.channel !== process.env.CHANNEL_SANDBOX) {
			return;
		}

		mutex.runExclusive(async () => {
			try {
				if (
					message.text &&
					message.text.match(/^(?:市?区?町?村?)章当てクイズ$/)
				) {
					const citySymbol = await getRandomCitySymbol();
					const quizText = 'この市区町村章ど～こだ？';
					const imageUrl = getWikimediaImageUrl(sample(citySymbol.files));
					const problem = {
						problemMessage: {
							channel: message.channel,
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
										image_url: imageUrl,
										alt_text: '市区町村章',
									},
								},
							],
						},
						hintMessages: [
							{
								channel: message.channel,
								text: `ヒント: ${citySymbol.prefectureName}の市区町村ですよ～`,
							},
						],
						immediateMessage: {
							channel: message.channel,
							text: '60秒以内に回答してね！',
							blocks: [
								{
									type: 'section',
									text: {
										type: 'plain_text',
										text: '60秒以内に回答してね！',
									},
								},
								{
									type: 'image',
									image_url: imageUrl,
									alt_text: '市区町村章',
								},
							],
						},
						solvedMessage: {
							channel: message.channel,
							text: typicalMessageTextsGenerator.solved(` ＊${citySymbol.prefectureName}${citySymbol.cityName}＊ `),
							reply_broadcast: true,
						},
						unsolvedMessage: {
							channel: message.channel,
							text: typicalMessageTextsGenerator.unsolved(` ＊${citySymbol.prefectureName}${citySymbol.cityName}＊ `),
							reply_broadcast: true,
						},
						answerMessage: {
							channel: message.channel,
							text: '市区町村章',
							blocks: [
								{
									type: 'image',
									image_url: imageUrl,
									alt_text: citySymbol.cityName,
								},
								{
									type: 'section',
									text: {
										type: 'mrkdwn',
										text: [
											`＊${citySymbol.prefectureName}${citySymbol.cityName}＊`,
											`${citySymbol.reason}`,
											`制定年月日: ${citySymbol.date}`,
											`備考: ${citySymbol.notes || 'なし'}`,
										].join('\n'),
									},
								},
							],
						},
						correctAnswers: [
							citySymbol.cityName,
							citySymbol.cityName.replace(/(市|区|町|村)$/g, ''),
							`${citySymbol.prefectureName}${citySymbol.cityName}`,
						],
					};

					const quiz = new CitySymbolAteQuiz(slackClients, problem, {
						username: '市章当てクイズ',
						icon_emoji: ':cityscape:',
					});
					const result = await quiz.start();

					if (result.state === 'solved') {
						await increment(result.correctAnswerer, 'city-symbol-answer');
					}
				}
			} catch (error) {
				console.error(error.stack);

				await slackClients.webClient.chat.postMessage({
					channel: message.channel,
					text: `エラーが発生しました: ${error.message}`,
				});
			}
		});
	});
};
