import axios from 'axios';
import type { ScrapeOptions } from 'scrape-it';
import { vi } from 'vitest';

const mockScrapeIt = async (url: string, opts: ScrapeOptions) => {
	const scrapeIt = await vi.importActual<typeof import('scrape-it')>('scrape-it');
	const cheerio = await vi.importActual<typeof import('cheerio')>('cheerio');
	const res = await axios(url);

	return {
		data: scrapeIt.scrapeHTML(cheerio.load(res.data), opts),
	};
};

export default mockScrapeIt;
