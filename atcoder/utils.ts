import {last} from 'lodash';
import scrapeIt from 'scrape-it';

interface Submission {
	time: Date,
	problemId: string,
	problemName: string,
	userId: string,
	languageId: number,
	language: string,
	point: number
	length: number,
	result: string,
	executionTime: number,
	memoryUsage: number,
	id: number,
}

interface SubmissionsData {
	maxPage: number,
	submissions: Submission[],
}

export const crawlSubmissionsByUser = async (contestId: string, user: string) => {
	let page = 1;
	const submissionsMap: Map<number, Submission> = new Map();

	while (page < 100) {
		const url = `https://atcoder.jp/contests/${contestId}/submissions?f.User=${user}&page=${page}`;
		const {data} = await scrapeIt<SubmissionsData>(url, {
			maxPage: {
				selector: 'div:last-child > .pagination > li:last-child',
				convert: (text) => parseInt(text),
			},
			submissions: {
				listItem: '.panel-submission .table tbody > tr',
				data: {
					time: {
						selector: 'td:nth-child(1)',
						convert: (d) => new Date(d),
					},
					problemId: {
						selector: 'td:nth-child(2) > a',
						attr: 'href',
						convert: (text) => last(text.split('/')),
					},
					problemName: {
						selector: 'td:nth-child(2)',
					},
					userId: {
						selector: 'td:nth-child(3)',
					},
					languageId: {
						selector: 'td:nth-child(4) > a',
						attr: 'href',
						convert: (u) => parseInt(new URL(u, url).searchParams.get('f.Language')),
					},
					language: {
						selector: 'td:nth-child(4)',
					},
					point: {
						selector: 'td:nth-child(5)',
						convert: (text) => parseInt(text),
					},
					length: {
						selector: 'td:nth-child(6)',
						convert: (text) => parseInt(text),
					},
					result: {
						selector: 'td:nth-child(7)',
					},
					executionTime: {
						selector: 'td:nth-child(8)',
						convert: (text) => parseInt(text),
					},
					memoryUsage: {
						selector: 'td:nth-child(9)',
						convert: (text) => parseInt(text),
					},
					id: {
						selector: 'td:last-child > a',
						attr: 'href',
						convert: (text) => parseInt(last(text.split('/'))),
					},
				},
			},
		});

		for (const submission of data.submissions) {
			submissionsMap.set(submission.id, submission);
		}

		if (data.submissions.length === 0 || data.maxPage === page) {
			break;
		}

		page++;
	}

	return Array.from(submissionsMap.values()).sort((a, b) => a.time.getTime() - b.time.getTime());
};
