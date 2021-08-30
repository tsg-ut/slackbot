// See ../atcoder/utils.ts for reference.

import {last} from 'lodash';
import scrapeIt from 'scrape-it';

export interface Problem {
	url: string;
	contestId: string;
	taskId: string;
}

export interface Submission {
	time: Date;
	problemId: string;
	problemName: string;
	userId: string;
	languageId: number;
	language: string;
	point: number;
	length: number;
	result: string;
	executionTime: number;
	memoryUsage: number;
	id: number;
}

interface SubmissionsData {
	maxPage: number;
	submissions: Submission[];
}

interface CrawlSubmissionsQuery {
	language?: string;
	status?: string;
	task?: string;
	user?: string;
	since?: Date;
	until?: Date;
}

export const crawlSubmissions = async (contestId: string, query: CrawlSubmissionsQuery): Promise<Submission[]> => {
	let page = 1;
	const submissionsMap: Map<number, Submission> = new Map();

	loop: while (page < 100) {
		const url = new URL(`https://atcoder.jp/contests/${contestId}/submissions`);
		if (query.language) url.searchParams.append('f.Language', query.language);
		if (query.status) url.searchParams.append('f.Status', query.status);
		if (query.task) url.searchParams.append('f.Task', query.task);
		if (query.user) url.searchParams.append('f.User', query.user);
		url.searchParams.append('page', `${page}`);
		const {data} = await scrapeIt<SubmissionsData>(url.toString(), {
			maxPage: {
				selector: 'div:last-child > .pagination > li:last-child',
				convert: text => parseInt(text),
			},
			submissions: {
				listItem: '.panel-submission .table tbody > tr',
				data: {
					time: {
						selector: 'td:nth-child(1)',
						convert: d => new Date(d),
					},
					problemId: {
						selector: 'td:nth-child(2) > a',
						attr: 'href',
						convert: text => last(text.split('/')),
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
						convert: u => parseInt(new URL(u, url).searchParams.get('f.Language')!),
					},
					language: {
						selector: 'td:nth-child(4)',
					},
					point: {
						selector: 'td:nth-child(5)',
						convert: text => parseInt(text),
					},
					length: {
						selector: 'td:nth-child(6)',
						convert: text => parseInt(text),
					},
					result: {
						selector: 'td:nth-child(7)',
					},
					executionTime: {
						selector: 'td:nth-child(8)',
						convert: text => parseInt(text),
					},
					memoryUsage: {
						selector: 'td:nth-child(9)',
						convert: text => parseInt(text),
					},
					id: {
						selector: 'td:last-child > a',
						attr: 'href',
						convert: text => parseInt(last(text.split('/'))!),
					},
				},
			},
		});

		for (const submission of data.submissions) {
			if (query.until && submission.time.getTime() >= query.until.getTime()) {
				continue;
			}
			if (query.since && submission.time.getTime() < query.since.getTime()) {
				break loop;
			}
			submissionsMap.set(submission.id, submission);
		}

		if (data.submissions.length === 0 || data.maxPage === page) {
			break;
		}

		page++;
	}

	return Array.from(submissionsMap.values()).sort((a, b) => a.time.getTime() - b.time.getTime());
};

interface SubmissionData {
	code: string;
}

export const crawlSourceCode = async (contestId: string, submissionId: number): Promise<string> => {
	const url = `https://atcoder.jp/contests/${contestId}/submissions/${submissionId}`;
	const {data} = await scrapeIt<SubmissionData>(url, {
		code: {
			selector: '#submission-code',
		},
	});
	return data.code;
};

export type Standings = {
	userId: string;
	submission: Submission;
}[];

const compareSubmissions = (a: Submission, b: Submission): number => {
	const byLength = a.length - b.length;
	if (byLength !== 0) return byLength;

	const byTime = a.time.getTime() - b.time.getTime();
	if (byTime !== 0) return byTime;

	const byId = a.id - b.id;
	return byId;
};

export const computeStandings = (submissions: Submission[]): Standings => {
	const standings = new Map<string, Submission>();
	for (const submission of submissions) {
		const currentShortest = standings.get(submission.userId);
		if (currentShortest) {
			if (compareSubmissions(submission, currentShortest) < 0) {
				standings.set(submission.userId, submission);
			}
		} else {
			standings.set(submission.userId, submission);
		}
	}
	return Array.from(standings.entries())
		.map(([userId, submission]) => ({userId, submission}))
		.sort((a, b) => compareSubmissions(a.submission, b.submission));
};
