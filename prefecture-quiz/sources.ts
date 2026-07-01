import {load as cheerioLoad} from 'cheerio';
import {sample} from 'lodash';
import qs from 'querystring';
import {z} from 'zod';
import logger from '../lib/logger';
import {
	getPrefectureWikipediaSection,
	getRandomCategoryArticle,
	getRelatedArticle,
} from './wikipedia';

const log = logger.child({bot: 'prefecture-quiz/sources'});

export interface ArticleSource {
	title: string;
	content: string;
}

export interface WebSource {
	name: string;
	url: string;
	content: string;
}

export interface PrefectureSources {
	wikipediaSection: ArticleSource | null;
	relatedArticle: ArticleSource | null;
	tourismArticle: ArticleSource | null;
	foodArticle: ArticleSource | null;
	worksArticle: ArticleSource | null;
	webSource: WebSource | null;
	statistics: string | null;
}

const withTimeout = <T>(promise: Promise<T>, ms: number): Promise<T> =>
	Promise.race([
		promise,
		new Promise<T>((_, reject) =>
			setTimeout(() => reject(new Error('Timeout')), ms),
		),
	]);

const MediaWikiRevisionsSchema = z.object({
	query: z.object({
		pages: z.record(z.object({
			revisions: z.array(z.object({'*': z.string()})).optional(),
			missing: z.literal('').optional(),
		})),
	}),
});

async function getChakuwikiContent(prefBaseName: string): Promise<WebSource | null> {
	try {
		const chakuwikiApiUrl = `https://chakuwiki.org/w/api.php?${qs.encode({
			format: 'json',
			action: 'query',
			prop: 'revisions',
			rvprop: 'content',
			titles: prefBaseName,
		})}`;

		const response = await fetch(chakuwikiApiUrl);
		const json = await response.json();
		const parsed = MediaWikiRevisionsSchema.safeParse(json);
		if (!parsed.success) return null;

		const page = Object.values(parsed.data.query.pages)[0];
		if (!page || 'missing' in page || !page.revisions) return null;

		const content = page.revisions[0]['*'];

		// Extract list items (rumors) up to 3000 chars
		const lines = content.split('\n');
		const items: string[] = [];
		for (const line of lines) {
			const m = line.match(/^#(?!\*)(.+)$/);
			if (m) {
				items.push(m[1].trim()
					.replaceAll(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
					.replaceAll(/\[\[([^\]]+)\]\]/g, '$1')
					.replaceAll(/'{2,}/g, ''));
			}
		}
		const text = items.map((i) => `* ${i}`).join('\n').slice(0, 3000);
		if (!text) return null;

		return {
			name: 'Chakuwiki',
			url: `https://chakuwiki.org/wiki/${encodeURIComponent(prefBaseName)}`,
			content: text,
		};
	} catch (error) {
		log.warn(`Failed to get Chakuwiki content for ${prefBaseName}: ${error}`);
		return null;
	}
}

async function getWikitravelContent(prefName: string): Promise<WebSource | null> {
	try {
		const url = `https://wikitravel.org/wiki/ja/index.php?action=raw&title=${encodeURIComponent(prefName)}`;
		const response = await fetch(url, {
			headers: {'User-Agent': 'TSGSlackbot/1.0 prefecture-quiz'},
		});
		if (!response.ok) return null;

		const text = await response.text();
		// Strip wikitext markup
		const clean = text
			.replaceAll(/\[\[(?:File|Image|ファイル):[^\]]+\]\]/gi, '')
			.replaceAll(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
			.replaceAll(/\[\[([^\]]+)\]\]/g, '$1')
			.replaceAll(/\{\{[^}]+\}\}/g, '')
			.replaceAll(/'{2,}/g, '')
			.replaceAll(/={2,}[^=]+=+/g, '')
			.trim()
			.slice(0, 3000);

		if (!clean) return null;

		return {
			name: 'Wikitravel',
			url: `https://wikitravel.org/ja/${encodeURIComponent(prefName)}`,
			content: clean,
		};
	} catch (error) {
		log.warn(`Failed to get Wikitravel content for ${prefName}: ${error}`);
		return null;
	}
}

async function getKotobankContent(prefName: string): Promise<WebSource | null> {
	try {
		const response = await fetch(`https://kotobank.jp/word/${encodeURIComponent(prefName)}`, {
			headers: {'User-Agent': 'TSGSlackbot/1.0 prefecture-quiz'},
		});
		if (!response.ok) return null;

		const text = await response.text();
		const $ = cheerioLoad(text);

		// Try various article sections
		const selectors = ['article .description', '.article-body', '.description'];
		let description = '';
		for (const sel of selectors) {
			const el = $(sel).first();
			if (el.length > 0) {
				description = el.text().replaceAll(/\s+/g, ' ').trim();
				if (description.length > 100) break;
			}
		}
		if (!description) return null;

		return {
			name: 'コトバンク',
			url: `https://kotobank.jp/word/${encodeURIComponent(prefName)}`,
			content: description.slice(0, 3000),
		};
	} catch (error) {
		log.warn(`Failed to get Kotobank content for ${prefName}: ${error}`);
		return null;
	}
}

async function getTodoRanStatistics(prefRomaji: string, prefName: string): Promise<string | null> {
	try {
		const url = `https://todo-ran.com/t/tdfk/${encodeURIComponent(prefRomaji)}`;
		const response = await fetch(url, {
			headers: {'User-Agent': 'TSGSlackbot/1.0 prefecture-quiz'},
		});
		if (!response.ok) return null;

		const text = await response.text();
		const $ = cheerioLoad(text);

		const items: string[] = [];
		// Find rows where this prefecture is ranked 1st
		$('table tr').each((_, row) => {
			const cells = $(row).find('td');
			if (cells.length < 3) return;
			const rankCell = cells.eq(0).text().trim();
			if (rankCell !== '1' && rankCell !== '1位') return;
			const statName = cells.eq(1).text().trim() || $(row).find('th').first().text().trim();
			const value = cells.eq(2).text().trim();
			if (statName) {
				items.push(`${statName}: ${value}`);
			}
		});

		// Also try list-based layout
		if (items.length === 0) {
			$('li').each((_, el) => {
				const text2 = $(el).text().trim();
				if (text2.includes('1位') || text2.includes('全国1位')) {
					items.push(text2);
				}
			});
		}

		if (items.length === 0) return null;
		return `${prefName}が1位の統計データ:\n${items.join('\n')}`.slice(0, 2000);
	} catch (error) {
		log.warn(`Failed to get todo-ran statistics for ${prefRomaji}: ${error}`);
		return null;
	}
}

// Strip trailing 道/都/府/県 for Chakuwiki article name
const stripSuffix = (prefName: string): string => prefName.replace(/[都道府県]$/, '');

type WebSourceType = 'chakuwiki' | 'wikitravel' | 'kotobank';

async function getRandomWebSource(prefName: string): Promise<WebSource | null> {
	const types: WebSourceType[] = ['chakuwiki', 'wikitravel', 'kotobank'];
	// Shuffle and try until one succeeds
	const order = [...types].sort(() => Math.random() - 0.5);
	for (const type of order) {
		let result: WebSource | null = null;
		if (type === 'chakuwiki') {
			result = await getChakuwikiContent(stripSuffix(prefName));
		} else if (type === 'wikitravel') {
			result = await getWikitravelContent(prefName);
		} else {
			result = await getKotobankContent(prefName);
		}
		if (result) return result;
	}
	return null;
}

export async function collectSources(prefName: string, prefRomaji: string): Promise<PrefectureSources> {
	log.info(`Collecting sources for ${prefName} (${prefRomaji})`);

	const TIMEOUT_MS = 15_000;

	const [
		wikipediaSection,
		relatedArticle,
		tourismArticle,
		foodArticle,
		worksArticle,
		webSource,
		statistics,
	] = await Promise.all([
		withTimeout(getPrefectureWikipediaSection(prefName), TIMEOUT_MS).catch((): ArticleSource | null => null),
		withTimeout(getRelatedArticle(prefName), TIMEOUT_MS).catch((): ArticleSource | null => null),
		withTimeout(getRandomCategoryArticle(prefName, '観光地'), TIMEOUT_MS).catch((): ArticleSource | null => null),
		withTimeout(getRandomCategoryArticle(prefName, '食文化'), TIMEOUT_MS).catch((): ArticleSource | null => null),
		withTimeout(getRandomCategoryArticle(prefName, '舞台とした作品'), TIMEOUT_MS).catch((): ArticleSource | null => null),
		withTimeout(getRandomWebSource(prefName), TIMEOUT_MS).catch((): WebSource | null => null),
		withTimeout(getTodoRanStatistics(prefRomaji, prefName), TIMEOUT_MS).catch((): string | null => null),
	]);

	log.info(`Sources collected for ${prefName}: wikipedia=${!!wikipediaSection}, related=${!!relatedArticle}, tourism=${!!tourismArticle}, food=${!!foodArticle}, works=${!!worksArticle}, web=${!!webSource}, stats=${!!statistics}`);

	return {
		wikipediaSection,
		relatedArticle,
		tourismArticle,
		foodArticle,
		worksArticle,
		webSource,
		statistics,
	};
}
