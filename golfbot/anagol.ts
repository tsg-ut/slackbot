import scrapeIt from 'scrape-it';

export interface Problem {
	url: string;
	problemId: string;
}

export interface Submission {
	rank: string;
	user: string;
	size: number;
	time: number;
	date: Date;
	statistics: string;
	url: string | null;
}

interface SubmissionsData {
	languages: {id: string}[];
	byLanguage: {submissions: Submission[]}[];
}

export const crawlStandings = async (problemId: string, languageId: string): Promise<Submission[]> => {
	const url = `http://golf.shinh.org/p.rb?${problemId}`;
	const {data} = await scrapeIt<SubmissionsData>(url, {
		languages: {
			listItem: 'body > h3',
			data: {
				id: {
					selector: 'a:nth-child(1)',
					attr: 'href',
					convert: text => text.split('?')[1],
				},
			},
		},
		byLanguage: {
			listItem: 'body > table',
			data: {
				submissions: {
					listItem: 'tr:not(:first-child)',
					data: {
						rank: {
							selector: 'td:nth-child(1)',
							convert: text => parseInt(text),
						},
						user: {
							selector: 'td:nth-child(2)',
						},
						size: {
							selector: 'td:nth-child(3)',
							convert: text => parseInt(text),
						},
						time: {
							selector: 'td:nth-child(4)',
							convert: text => Number(text),
						},
						date: {
							selector: 'td:nth-child(5)',
							convert: text => new Date(text),
						},
						statistics: {
							selector: 'td:nth-child(6)',
						},
						url: {
							selector: 'td:nth-child(2) > a',
							attr: 'href',
							convert: text => (text ? new URL(text, url).toString() : null),
						},
					},
				},
			},
		},
	});

	const index = data.languages.findIndex(l => l.id === languageId);
	if (index < 0) {
		return [];
	} else {
		return data.byLanguage[index]?.submissions ?? [];
	}
};

interface SubmissionData {
	code: string | null;
}

export const crawlSourceCode = async (url: string): Promise<string | null> => {
	const {data} = await scrapeIt<SubmissionData>(url, {
		code: {
			selector: 'body > pre',
			convert: text => text || null,
		},
	});
	return data.code;
};
