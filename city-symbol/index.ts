import qs from 'querystring';
import {Mutex} from 'async-mutex';
import {stripIndent} from 'common-tags';
import {sample} from 'lodash';
import {increment} from '../achievements';
import {AteQuiz, typicalMessageTextsGenerator} from '../atequiz';
import logger from '../lib/logger';
import openai from '../lib/openai';
import {SlackInterface} from '../lib/slack';
import {Loader} from '../lib/utils';
import {PrefectureKanji, prefectures} from '../room-gacha/prefectures';

const mutex = new Mutex();

const log = logger.child({bot: 'city-symbol'});

const promptTemplate = stripIndent`
	# 指示

	{{cityname}}が答えになるクイズを作るとして、答えのヒントになるような短い文章を3つ作成してください。まず、{{cityname}}に関してあなたが知っている情報と、以下に示す{{cityname}}のWikipedia記事の内容をもとに、{{cityname}}に関する基本的な情報に関する辞書的な説明文を作成してください。続いて、{{cityname}}に関するニュースなどをもとに、有名な事実や面白いトリビアなどの情報をまとめてください。特に、この市町村が日本一であるようなことがらや、有名な観光地などについて優先的に列挙してください。次に、これらの情報から適切に取捨選択し、ヒントとして適切になるように組み合わせ、答えに導くような短いヒントを作成してください。ヒントには{{cityname}}に関連する固有名詞をなるべく多く含めてください。最後の行に、作成した3つのヒントを、string[]型を持つJSONの文字列の配列として出力してください。

	## ヒントとしての適切である基準

	* ヒントは「この市町村は、」や「この市町村には、」などの文言で始まる文章になっている。
	* ヒントの文章の一部に答えを直接含まない。
	* ほかの市町村には当てはまらない、{{cityname}}だけが該当する特徴を記述している。
	* ヒントの長さが50文字以内程度である。
	* ヒントに嘘の情報が含まれていない。
	* 知っていることが日々の生活でプラスになるような、面白い情報が含まれている。
	* ヒント1から3に進むにつれて、より答えに近い容易なヒントとなっている。

	## ほかの市町村でのヒントの出題例

	### 「高知県高知市」が答えとなるクイズのヒントの出題例

	ヒント1: この市町村には、東経133度33分33秒・北緯33度33分33秒の通称「地球33番地」と呼ばれる地点が存在します。
	ヒント2: この市町村では、現存する日本最古の路面電車である土佐電気鉄道が運行しています。
	ヒント3: この市町村は、2021年までかつおの消費量で全国1位でしたが、宮崎市に抜かれました。

	### 「神奈川県山北町」が答えとなるクイズのヒントの出題例

	ヒント1: この市町村には古くから「お峰入り」という民俗芸能が伝わっており、この伝統文化を含む「風流踊り」は2022年にユネスコ無形文化遺産に登録されました。
	ヒント2: この市町村には、日本の「ダム湖百選」にも選ばれたことで有名な丹沢湖があります。
	ヒント3: この市町村には、東名高速道路の渋滞ポイントとして有名な都夫良野トンネルがあります。

	### 「北海道幌加内町」が答えとなるクイズのヒントの出題例

	ヒント1: この市町村は、ソバの作付面積が日本一多いことで知られています。
	ヒント2: この市町村には、日本最大の人造湖である朱鞠内湖があります。
	ヒント3: この市町村では、非公式ながら1978年に-41.2度の気温を記録し、これは公式の日本最低気温である旭川市の-41.0度を下回る気温です。

	## {{cityname}}のWikipedia記事の内容

	{{wikipedia_content}}
`;

interface CitySymbol {
	prefectureName: string;
	cityName: string;
	cityWikipediaName: string;
	reason: string;
	date: string;
	notes: string;
	files: string[];
}

interface CityInformation {
	placeImage: string;
	plainText: string;
	ruby: string;
}

type City = CitySymbol & CityInformation;

const getWikipediaSource = async (prefName: string) => {
	const title = `${prefName}の${prefName === '東京都' ? '区' : ''}市町村章一覧`;
	log.info(`Getting wikipedia ${title}...`);
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
		const cityWikipediaName = line.match(new RegExp(`\\[\\[((:?[^|\\]]+\\|)?${cityName})\\]\\]`))?.[1] || '';

		citySymbols.push({
			prefectureName: prefName,
			cityName: cityName.trim().replaceAll('|', ''),
			cityWikipediaName: cityWikipediaName.split('|')[0].trim(),
			reason: reason.trim(),
			date: date.trim(),
			notes: notes.trim().replaceAll(/<br \/>/g, '\n'),
			files: [...files].map(([, file]) => file),
		});
	}

	return citySymbols;
};

const extractPlaceImage = (content: string) => {
	{
		const placeImageMatches = content.match(/位置画像.+\|image\s*=\s*(.+?)[|}]/);
		if (placeImageMatches?.[1]) {
			return placeImageMatches[1];
		}
	}

	{
		const placeImageMatches = content.match(/\{\{基礎自治体位置図\|(\d+)\|(\d+)\}\}/);
		if (placeImageMatches?.[1] && placeImageMatches?.[2]) {
			const prefCode = placeImageMatches[1].padStart(2, '0');
			const cityCode = placeImageMatches[2].padStart(3, '0');
			return `基礎自治体位置図_${prefCode}${cityCode}.svg`;
		}
	}

	throw new Error('Failed to extract place image');
};

const getPlaintextWikipedia = async (title: string): Promise<string> => {
	log.info(`Getting wikipedia ${title}...`);

	const url = `https://ja.wikipedia.org/w/api.php?${qs.encode({
		format: 'json',
		action: 'query',
		prop: 'extracts',
		explaintext: true,
		titles: title,
	})}`;

	const response = await fetch(url);
	const json = await response.json();

	const pages = json?.query?.pages;
	const content = pages?.[Object.keys(pages)[0]]?.extract;
	if (!content) {
		throw new Error('Failed to get wikipedia source');
	}

	return content;
};

const getCityInformation = async (title: string): Promise<CityInformation> => {
	log.info(`Getting wikipedia ${title}...`);

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

	const placeImage = extractPlaceImage(content);

	const plainText = await getPlaintextWikipedia(title);

	const rubyMatches = plainText.match(/（(.+?)）は/);
	const ruby = rubyMatches?.[1] ?? '';

	return {placeImage, ruby, plainText};
};

const getRandomCitySymbol = async (prefSet: Set<PrefectureKanji> = new Set(Object.keys(prefectures) as PrefectureKanji[]), allowEasterEgg: boolean = true): Promise<City> => {
	if (allowEasterEgg) {
		if (Math.random() < 1 / 1719) {
			return {
				prefectureName: '',
				cityName: '博多市',
				cityWikipediaName: '博多市',
				reason: '伯方の塩のパッケージに描かれている赤と青のストライプを直方体にあしらったもの',
				plainText: '',
				date: '2020年6月21日',
				notes: 'なし',
				files: ['https://raw.githubusercontent.com/hakatashi/icon/master/images/icon_480px.png'],
				placeImage: 'https://raw.githubusercontent.com/hakatashi/icon/master/images/icon_480px.png',
				ruby: 'はかたし',
			};
		}
	}

	const prefectureChosen = sample(Array.from(prefSet));
	const citySymbols = await getWikipediaSource(prefectureChosen);
	const citySymbol = sample(citySymbols);
	const cityInformation = await getCityInformation(citySymbol.cityWikipediaName);

	return {...citySymbol, ...cityInformation};
};

const getWikimediaImageUrl = (fileName: string) => {
	if (fileName.startsWith('http')) {
		return fileName;
	}
	return `https://commons.wikimedia.org/wiki/Special:FilePath/${qs.escape(fileName)}?width=200`;
};

const getCorrectAnswers = (city: City): string[] => (
	[
		`${city.prefectureName}${city.cityName}`,
		city.cityName,
		city.cityName.replace(/(市|区|町|村)$/, ''),
		...(city.ruby ? [
			city.ruby,
			city.ruby.replace(/(し|く|ちょう|まち|そん|むら)$/, ''),
		] : []),
	]
);

const generateAiHints = async (city: City): Promise<string[] | null> => {
	const cityname = `${city.prefectureName}${city.cityName}`;
	const prompt = promptTemplate
		.replaceAll(/{{cityname}}/g, cityname)
		.replaceAll(/{{reason}}/g, city.reason)
		.replaceAll(/{{wikipedia_content}}/g, city.plainText);

	log.info(`Generating AI hints for ${cityname}...`);

	const response = await openai.chat.completions.create({
		model: 'gpt-4o-mini',
		messages: [
			{
				role: 'user',
				content: prompt,
			},
		],
		max_tokens: 1024,
	});

	log.info(`Consumed tokens: ${response?.usage?.total_tokens} (prompt = ${response?.usage?.prompt_tokens}, completion = ${response?.usage?.completion_tokens})`);

	const result = response?.choices?.[0]?.message?.content;

	if (!result) {
		return null;
	}

	const hintJson = result.match(/\[.*?\]/)?.[0];
	if (!hintJson) {
		return null;
	}

	try {
		const hints = JSON.parse(hintJson);
		log.info(`Generated hints: ${hints.join(', ')}`);
		const correctAnswers = getCorrectAnswers(city);
		const concealedHints = hints.map((hint: string) => {
			let hintString = hint;
			for (const correctAnswer of correctAnswers.reverse()) {
				hintString = hintString.replaceAll(correctAnswer, '〇〇');
			}
			return hintString;
		});
		log.info(`Concealed hints: ${concealedHints.join(', ')}`);
		return concealedHints;
	} catch (error) {
		return null;
	}
};

class CitySymbolAteQuiz extends AteQuiz {
	hasPrefHint: boolean;

	waitSecGen(hintIndex: number): number {
		if (this.hasPrefHint) {
			if (hintIndex === 0) {
				return 30;
			}
			if (hintIndex === 1) {
				return 15;
			}
			return 10;
		}
		else {
			if (hintIndex === 0) {
				return 45;
			}
			return 10;
		}
	}
}

export default (slackClients: SlackInterface) => {
	const {eventClient} = slackClients;

	eventClient.on('message', (message) => {
		if (message.channel !== process.env.CHANNEL_SANDBOX) {
			return;
		}

		mutex.runExclusive(async () => {
			try {
				if (
					message.text &&
					message.text.match(/^(?:市?区?町?村?)章当てクイズ\s?(?:\p{sc=Han}+[都道府県])?$/u)
				) {
					const prefecture = message.text.match(/^(?:市?区?町?村?)章当てクイズ\s?(?<pref>\p{sc=Han}+[都道府県])?$/u)?.groups?.pref;

					if (prefecture && !Object.hasOwn(prefectures, prefecture)) {
						await slackClients.webClient.chat.postMessage({
							channel: message.channel,
							text: `${prefecture}という都道府県は存在しないよ:angry:`,
							username: '市章当てクイズ',
							icon_emoji: ':cityscape:',
						});
						return;
					}

					const needPrefHint = !prefecture;
					const city = prefecture ? await getRandomCitySymbol(new Set([prefecture as PrefectureKanji]), false) : await getRandomCitySymbol();
					const quizText = 'この市区町村章ど～こだ？';
					const imageUrl = getWikimediaImageUrl(sample(city.files));
					const correctAnswers = getCorrectAnswers(city);

					const aiHintsLoader = new Loader<string[]>(() => generateAiHints(city));
					aiHintsLoader.load();

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
						get hintMessages() {
							const aiHints = aiHintsLoader.get() ?? [];
							const hints = (needPrefHint ? [
								{
									channel: message.channel,
									text: `ヒント: ${city.prefectureName}の市区町村ですよ～`,
								}
							] : [])
							.concat([...aiHints.map((hint, index) => ({
								channel: message.channel,
								text: `ChatGPTヒント${index + 1}: ${hint}`,
							}))]);
							return hints;
						},
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
							text: typicalMessageTextsGenerator.solved(` ＊${city.prefectureName}${city.cityName}＊ `),
							reply_broadcast: true,
						},
						unsolvedMessage: {
							channel: message.channel,
							text: typicalMessageTextsGenerator.unsolved(` ＊${city.prefectureName}${city.cityName}＊ `),
							reply_broadcast: true,
						},
						get answerMessage() {
							const aiHints = aiHintsLoader.get() ?? [];
							const answerHeader = `${city.prefectureName}${city.cityName} (${city.ruby})`;
							const answerDetails = [
								`${city.reason}`,
								`制定年月日: ${city.date}`,
								`備考: ${city.notes || 'なし'}`,
								`有効回答一覧: ${correctAnswers.join(', ')}`,
							].join('\n');

							return {
								channel: message.channel,
								text: `${answerHeader}\n\n${answerDetails}`,
								blocks: [
									{
										type: 'image',
										image_url: imageUrl,
										alt_text: city.cityName,
									},
									{
										type: 'header',
										text: {
											type: 'plain_text',
											text: answerHeader,
										},
									},
									{
										type: 'section',
										text: {
											type: 'mrkdwn',
											text: answerDetails,
										},
									},
									{
										type: 'image',
										image_url: getWikimediaImageUrl(city.placeImage),
										alt_text: city.cityName,
									},
									...(aiHints.length === 0 ? [] : [
										{
											type: 'rich_text',
											elements: [
												{
													type: 'rich_text_section',
													elements: [
														{
															type: 'text',
															text: 'ChatGPTヒント',
														},
													],
												},
												{
													type: 'rich_text_list',
													style: 'ordered',
													indent: 0,
													border: 0,
													elements: aiHints.map((hint) => ({
														type: 'rich_text_section',
														elements: [
															{
																type: 'text',
																text: hint,
															},
														],
													})),
												},
											],
										},
									]),
								],
							};
						},
						correctAnswers,
					};

					const quiz = new CitySymbolAteQuiz(slackClients, problem, {
						username: '市章当てクイズ' + (prefecture ? ` (${prefecture})` : ''),
						icon_emoji: ':cityscape:',
					});
					quiz.hasPrefHint = needPrefHint;
					const result = await quiz.start();

					if (result.state === 'solved' && !prefecture) {
						await increment(result.correctAnswerer, 'city-symbol-answer');
					}
					if (city.cityName === '博多市') {
						await increment(result.correctAnswerer, 'city-symbol-answer-hakatashi');
					}
				}
			} catch (error) {
				log.error(error.stack);

				await slackClients.webClient.chat.postMessage({
					channel: message.channel,
					text: `エラーが発生しました: ${error.message}`,
				});
			}
		});
	});
};
