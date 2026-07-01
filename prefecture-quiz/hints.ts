import {stripIndent} from 'common-tags';
import logger from '../lib/logger';
import openai from '../lib/openai';
import {maskAnswers} from './answers';
import {getMunicipalitiesMap} from './municipalities';
import type {PrefectureSources} from './sources';

const log = logger.child({bot: 'prefecture-quiz/hints'});

const promptTemplate = stripIndent`
	# 指示

	{{prefname}}が答えになる都道府県当てクイズを作るとして、答えのヒントになるような短い文章を5つ作成してください。まず、以下に示す{{prefname}}に関するさまざまなソース文書の内容をもとに、{{prefname}}に関する基本的な情報に関する辞書的な説明文を作成してください。次に、これらの情報から適切に取捨選択し、ヒントとして適切になるように組み合わせ、答えに導くような短いヒントを5つ作成してください。ヒントには{{prefname}}に関連する固有名詞をなるべく多く含めてください。最後の行に、作成した5つのヒントを、string[]型を持つJSONの文字列の配列として出力してください。

	## ヒントとして積極的に含めるべき情報

	* この都道府県が日本一・世界一であることがら
	* この都道府県の観光地や名所（ソース文書に観光地の記事が含まれている場合は必ずその内容を活用すること）
	* この都道府県の特産品や名物料理・お土産（ソース文書に食文化の記事が含まれている場合は必ずその内容を活用すること）
	* この都道府県出身の有名人（誰でも知っている著名な人物に限る）
	* この都道府県に縁のある有名な出来事や歴史的事実
	* この都道府県を舞台とした有名な作品（ソース文書に作品の記事が含まれている場合は必ずその内容を活用すること）

	## ヒントとしての適切である基準

	* ヒントは「この都道府県は、」や「この都道府県には、」などの文言で始まる文章になっている。
	* ヒントの文章の一部に答えを直接含まない。
	* ほかの都道府県には当てはまらない、{{prefname}}だけが該当する特徴を記述している。
	* ヒントの長さが90文字以内程度である。
	* ヒントに嘘の情報が含まれていない。
	* 知っていることが日々の生活でプラスになるような、面白い情報が含まれている。
	* ヒント1が最も簡単で、誰でも知っているような直接的な情報を含んでいる。ヒント5が最も難しく、特定の分野に詳しくないと{{prefname}}を連想しにくい情報を含んでいる。
	* 難しいヒント（ヒント3〜5）には、一般的にあまり知られていない事実を優先的に含めること。その都道府県の歴史・産業・自然・統計データなど、専門的または局所的な知識を要する情報が望ましい。
	* 簡単なヒントでも、「その場所に行ったことがある人なら知っている」程度の情報を使うこと。県庁所在地名・人口・面積などの基礎情報はヒント1のみに使用を限定すること。

	## ほかの都道府県でのヒントの出題例

	### 「新潟県」が答えとなるクイズのヒントの出題例

	ヒント1: この都道府県は日本一の米どころとして広く知られており、「コシヒカリ」や「こしいぶき」など様々な品種の作付面積で1位となっています。
	ヒント2: この都道府県には、「柿の種」や「ハッピーターン」などの商品で知られる亀田製菓の本社が存在します。
	ヒント3: この都道府県には、江戸時代から約400年にわたり採掘が行われ、およそ78トン以上の金を産出した日本を代表する金鉱山が存在します。
	ヒント4: この都道府県は、日本で神社の数が最も多く、約4,700社にのぼる神社が現在も各地に息づいています。
	ヒント5: この都道府県は、火焔土器で有名な馬高・三十稲場遺跡を有しており、縄文時代の暮らしを伝える博物館が数多く存在します。

	## 注意事項

	* 市区町村名（例: 会津若松市、喜多方市、長岡市、〇〇市、〇〇区、〇〇町、〇〇村など）や、都市名・地区名を含む具体的な地名はヒントに含めないこと。地名を入れると答えが自明になりすぎるため、地名の代わりに「そこで行われていること」「その場所が持つ特性」に焦点を当てること。
	* 都道府県名や旧国名が含まれる場合は「〇〇」と伏せること（ヒント生成後に自動的に処理されるため、生成段階では意識不要）

	{{sources}}
`;

function buildSourcesText(prefName: string, sources: PrefectureSources): string {
	const parts: string[] = [];

	if (sources.wikipediaSection) {
		parts.push(`## ${sources.wikipediaSection.title}のWikipedia記事\n\n${sources.wikipediaSection.content}`);
	}
	if (sources.relatedArticle) {
		parts.push(`## 関連記事「${sources.relatedArticle.title}」のWikipedia記事\n\n${sources.relatedArticle.content}`);
	}
	if (sources.tourismArticle) {
		parts.push(`## ${prefName}の観光地「${sources.tourismArticle.title}」のWikipedia記事\n\n${sources.tourismArticle.content}`);
	}
	if (sources.foodArticle) {
		parts.push(`## ${prefName}の食文化「${sources.foodArticle.title}」のWikipedia記事\n\n${sources.foodArticle.content}`);
	}
	if (sources.worksArticle) {
		parts.push(`## ${prefName}を舞台とした作品「${sources.worksArticle.title}」のWikipedia記事\n\n${sources.worksArticle.content}`);
	}
	if (sources.webSource) {
		parts.push(`## ${sources.webSource.name}の記事 (${sources.webSource.url})\n\n${sources.webSource.content}`);
	}
	if (sources.statistics) {
		parts.push(sources.statistics);
	}

	return parts.join('\n\n---\n\n');
}

export async function generateAiHints(
	prefName: string,
	sources: PrefectureSources,
): Promise<string[] | null> {
	const sourcesText = buildSourcesText(prefName, sources);
	const prompt = promptTemplate
		.replaceAll('{{prefname}}', prefName)
		.replaceAll('{{sources}}', sourcesText);

	log.info(`Generating AI hints for ${prefName}...`);

	try {
		const [response, municipalitiesMap] = await Promise.all([
			openai.chat.completions.create({
				model: 'gpt-4o-mini',
				messages: [{role: 'user', content: prompt}],
				max_tokens: 2048,
			}),
			getMunicipalitiesMap(),
		]);

		log.info(`Consumed tokens: ${response?.usage?.total_tokens} (prompt=${response?.usage?.prompt_tokens}, completion=${response?.usage?.completion_tokens})`);

		const result = response?.choices?.[0]?.message?.content;
		if (!result) return null;

		const hintJson = result.match(/\[[\s\S]*?\]/)?.[0];
		if (!hintJson) {
			log.warn(`No JSON array found in response for ${prefName}`);
			return null;
		}

		const rawHints = JSON.parse(hintJson) as string[];
		if (!Array.isArray(rawHints) || rawHints.length === 0) return null;

		// AI generates easy→hard; reverse so quiz presents hard→easy
		const municipalities = municipalitiesMap[prefName] ?? [];
		const maskedHints = [...rawHints].reverse().map((hint) => maskAnswers(hint, prefName, municipalities));

		log.info(`Generated hints for ${prefName}: ${maskedHints.join(' | ')}`);
		return maskedHints;
	} catch (error) {
		log.error(`Failed to generate AI hints for ${prefName}: ${error}`);
		return null;
	}
}
