"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.crawlSubmissionsByUser = void 0;
const lodash_1 = require("lodash");
const scrape_it_1 = __importDefault(require("scrape-it"));
const crawlSubmissionsByUser = async (contestId, user) => {
    let page = 1;
    const submissionsMap = new Map();
    while (page < 100) {
        const url = `https://atcoder.jp/contests/${contestId}/submissions?f.User=${user}&page=${page}`;
        const { data } = await (0, scrape_it_1.default)(url, {
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
                        convert: (text) => (0, lodash_1.last)(text.split('/')),
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
                        convert: (text) => parseInt((0, lodash_1.last)(text.split('/'))),
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
exports.crawlSubmissionsByUser = crawlSubmissionsByUser;
