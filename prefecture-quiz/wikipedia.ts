import qs from 'querystring';
import {sample} from 'lodash';
import {z} from 'zod';
import logger from '../lib/logger';

const log = logger.child({bot: 'prefecture-quiz/wikipedia'});

const WIKI_HEADERS = {
	'User-Agent': 'TSGSlackbot/1.0 (https://github.com/tsg-ut/slackbot) prefecture-quiz',
};

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const MediaWikiExtractResponseSchema = z.object({
	query: z.object({
		pages: z.record(z.object({
			extract: z.string().optional(),
			missing: z.literal('').optional(),
		})),
	}),
});

const MediaWikiCategoryResponseSchema = z.object({
	query: z.object({
		categorymembers: z.array(z.object({
			title: z.string(),
			ns: z.number(),
		})),
	}),
	continue: z.object({
		cmcontinue: z.string(),
	}).optional(),
});

const MediaWikiSectionsResponseSchema = z.object({
	parse: z.object({
		sections: z.array(z.object({
			line: z.string(),
			index: z.string(),
		})),
	}),
});

async function wikiApiFetch(url: string): Promise<unknown> {
	const response = await fetch(url, {headers: WIKI_HEADERS});
	const text = await response.text();
	return JSON.parse(text);
}

export async function getPlaintextWikipedia(title: string): Promise<string | null> {
	const url = `https://ja.wikipedia.org/w/api.php?${qs.encode({
		format: 'json',
		action: 'query',
		prop: 'extracts',
		explaintext: true,
		titles: title,
	})}`;

	try {
		const json = await wikiApiFetch(url);
		const parsed = MediaWikiExtractResponseSchema.safeParse(json);
		if (!parsed.success) return null;

		const page = Object.values(parsed.data.query.pages)[0];
		if (!page || 'missing' in page) return null;
		return page.extract ?? null;
	} catch (error) {
		log.warn(`Failed to get Wikipedia plaintext for ${title}: ${error}`);
		return null;
	}
}

const TARGET_SECTIONS = ['概要', '地理', '歴史', '経済・産業', '交通', '文化・スポーツ'];

export async function getPrefectureWikipediaSection(prefName: string): Promise<{title: string; content: string} | null> {
	try {
		const sectionsUrl = `https://ja.wikipedia.org/w/api.php?${qs.encode({
			format: 'json',
			action: 'parse',
			page: prefName,
			prop: 'sections',
		})}`;

		const sectionsJson = await wikiApiFetch(sectionsUrl);
		const sectionsParsed = MediaWikiSectionsResponseSchema.safeParse(sectionsJson);
		if (!sectionsParsed.success) {
			log.warn(`Failed to parse sections for ${prefName}`);
			return null;
		}

		const matchingSections = sectionsParsed.data.parse.sections.filter(
			(s) => TARGET_SECTIONS.includes(s.line),
		);
		if (matchingSections.length === 0) return null;

		const chosen = sample(matchingSections)!;

		await sleep(200);

		const contentUrl = `https://ja.wikipedia.org/w/api.php?${qs.encode({
			format: 'json',
			action: 'parse',
			page: prefName,
			prop: 'wikitext',
			section: chosen.index,
		})}`;

		const contentJson = await wikiApiFetch(contentUrl);
		const contentParsed = z.object({parse: z.object({wikitext: z.object({'*': z.string()})})}).safeParse(contentJson);
		if (!contentParsed.success) return null;

		const rawText = contentParsed.data.parse.wikitext['*'];
		const cleanText = stripWikitext(rawText).slice(0, 3000);

		return {title: `${prefName}/${chosen.line}`, content: cleanText};
	} catch (error) {
		log.warn(`Failed to get Wikipedia section for ${prefName}: ${error}`);
		return null;
	}
}

export async function getRelatedArticle(prefName: string): Promise<{title: string; content: string} | null> {
	try {
		const sectionsUrl = `https://ja.wikipedia.org/w/api.php?${qs.encode({
			format: 'json',
			action: 'parse',
			page: prefName,
			prop: 'sections',
		})}`;

		const sectionsJson = await wikiApiFetch(sectionsUrl);
		const sectionsParsed = MediaWikiSectionsResponseSchema.safeParse(sectionsJson);
		if (!sectionsParsed.success) return null;

		const relatedSection = sectionsParsed.data.parse.sections.find((s) => s.line === '関連項目');
		if (!relatedSection) return null;

		await sleep(200);

		const sectionUrl = `https://ja.wikipedia.org/w/api.php?${qs.encode({
			format: 'json',
			action: 'parse',
			page: prefName,
			prop: 'wikitext',
			section: relatedSection.index,
		})}`;

		const sectionJson = await wikiApiFetch(sectionUrl);
		const sectionParsed = z.object({parse: z.object({wikitext: z.object({'*': z.string()})})}).safeParse(sectionJson);
		if (!sectionParsed.success) return null;

		const wikitext = sectionParsed.data.parse.wikitext['*'];

		const linkMatches = [...wikitext.matchAll(/\[\[([^\]|#]+)(?:\|[^\]]+)?\]\]/g)];
		const titles = linkMatches
			.map((m) => m[1].trim())
			.filter((t) => !t.includes(':') && t.length > 0);

		if (titles.length === 0) return null;

		const chosenTitle = sample(titles)!;

		await sleep(200);

		const content = await getPlaintextWikipedia(chosenTitle);
		if (!content) return null;

		return {title: chosenTitle, content: content.slice(0, 2000)};
	} catch (error) {
		log.warn(`Failed to get related article for ${prefName}: ${error}`);
		return null;
	}
}

export async function getCategoryArticles(categoryTitle: string, maxDepth = 1): Promise<string[]> {
	const articles: string[] = [];
	const subcategories: string[] = [];

	try {
		const params: Record<string, string | number> = {
			format: 'json',
			action: 'query',
			list: 'categorymembers',
			cmtitle: `Category:${categoryTitle}`,
			cmlimit: 100,
			cmtype: 'page|subcat',
		};

		const url = `https://ja.wikipedia.org/w/api.php?${qs.encode(params)}`;
		const json = await wikiApiFetch(url);
		const parsed = MediaWikiCategoryResponseSchema.safeParse(json);
		if (parsed.success) {
			for (const member of parsed.data.query.categorymembers) {
				if (member.ns === 0) {
					articles.push(member.title);
				} else if (member.ns === 14 && maxDepth > 0) {
					subcategories.push(member.title.replace(/^Category:/, ''));
				}
			}
		}
	} catch (error) {
		log.warn(`Failed to get category members for ${categoryTitle}: ${error}`);
	}

	// Recurse into subcategories sequentially to avoid rate limiting
	if (maxDepth > 0 && subcategories.length > 0) {
		for (const sub of subcategories.slice(0, 5)) {
			await sleep(300);
			try {
				const subArticles = await getCategoryArticles(sub, maxDepth - 1);
				articles.push(...subArticles);
				if (articles.length >= 100) break;
			} catch {
				// continue
			}
		}
	}

	return articles;
}

export async function getRandomCategoryArticle(
	prefName: string,
	categorySuffix: string,
): Promise<{title: string; content: string} | null> {
	try {
		const categoryTitle = `${prefName}の${categorySuffix}`;
		const articles = await getCategoryArticles(categoryTitle);
		if (articles.length === 0) return null;

		const chosenTitle = sample(articles)!;

		await sleep(200);

		const content = await getPlaintextWikipedia(chosenTitle);
		if (!content) return null;

		return {title: chosenTitle, content: content.slice(0, 2000)};
	} catch (error) {
		log.warn(`Failed to get random category article for ${prefName}の${categorySuffix}: ${error}`);
		return null;
	}
}

function stripWikitext(text: string): string {
	return text
		.replaceAll(/<ref[^/>]*>.*?<\/ref>/gs, '')
		.replaceAll(/<ref[^>]*\/>/g, '')
		.replaceAll(/\[\[(?:File|Image|ファイル):[^\]]+\]\]/gi, '')
		.replaceAll(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
		.replaceAll(/\[\[([^\]]+)\]\]/g, '$1')
		.replaceAll(/\{\{[^}]+\}\}/g, '')
		.replaceAll(/'{2,}/g, '')
		.replaceAll(/^\|.*/gm, '')
		.replaceAll(/={2,}[^=]+=+/g, '')
		.trim();
}
