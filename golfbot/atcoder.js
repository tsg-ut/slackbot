"use strict";
// See ../atcoder/utils.ts for reference.
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.computeStandings = exports.crawlSourceCode = exports.crawlSubmissions = void 0;
const lodash_1 = require("lodash");
const scrape_it_1 = __importDefault(require("scrape-it"));
const crawlSubmissions = async (contestId, query) => {
    let page = 1;
    const submissionsMap = new Map();
    loop: while (page < 100) {
        const url = new URL(`https://atcoder.jp/contests/${contestId}/submissions`);
        if (query.language)
            url.searchParams.append('f.Language', query.language);
        if (query.status)
            url.searchParams.append('f.Status', query.status);
        if (query.task)
            url.searchParams.append('f.Task', query.task);
        if (query.user)
            url.searchParams.append('f.User', query.user);
        url.searchParams.append('page', `${page}`);
        const { data } = await (0, scrape_it_1.default)(url.toString(), {
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
                        convert: text => (0, lodash_1.last)(text.split('/')),
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
                        convert: u => parseInt(new URL(u, url).searchParams.get('f.Language')),
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
                        convert: text => parseInt((0, lodash_1.last)(text.split('/'))),
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
exports.crawlSubmissions = crawlSubmissions;
const crawlSourceCode = async (contestId, submissionId) => {
    const url = `https://atcoder.jp/contests/${contestId}/submissions/${submissionId}`;
    const { data } = await (0, scrape_it_1.default)(url, {
        code: {
            selector: '#submission-code',
        },
    });
    return data.code;
};
exports.crawlSourceCode = crawlSourceCode;
const compareSubmissions = (a, b) => {
    const byLength = a.length - b.length;
    if (byLength !== 0)
        return byLength;
    const byTime = a.time.getTime() - b.time.getTime();
    if (byTime !== 0)
        return byTime;
    const byId = a.id - b.id;
    return byId;
};
const computeStandings = (submissions) => {
    const standings = new Map();
    for (const submission of submissions) {
        const currentShortest = standings.get(submission.userId);
        if (currentShortest) {
            if (compareSubmissions(submission, currentShortest) < 0) {
                standings.set(submission.userId, submission);
            }
        }
        else {
            standings.set(submission.userId, submission);
        }
    }
    return Array.from(standings.entries())
        .map(([userId, submission]) => ({ userId, submission }))
        .sort((a, b) => compareSubmissions(a.submission, b.submission));
};
exports.computeStandings = computeStandings;
