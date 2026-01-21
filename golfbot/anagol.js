"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.crawlSourceCode = exports.crawlStandings = void 0;
const scrape_it_1 = __importDefault(require("scrape-it"));
const crawlStandings = async (problemId, languageId) => {
    const url = `http://golf.shinh.org/p.rb?${problemId}`;
    const { data } = await (0, scrape_it_1.default)(url, {
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
    }
    else {
        return data.byLanguage[index]?.submissions ?? [];
    }
};
exports.crawlStandings = crawlStandings;
const crawlSourceCode = async (url) => {
    const { data } = await (0, scrape_it_1.default)(url, {
        code: {
            selector: 'body > pre',
            convert: text => text || null,
        },
    });
    return data.code;
};
exports.crawlSourceCode = crawlSourceCode;
