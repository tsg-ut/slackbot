"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.findUserByNameTW = exports.fetchChallsTW = exports.fetchUserProfileTW = void 0;
const querystring_1 = __importDefault(require("querystring"));
const axios_1 = __importDefault(require("axios"));
const scrape_it_1 = __importDefault(require("scrape-it"));
const SAFELIMIT = 100;
const getAxiosClientTW = () => {
    const clientTW = axios_1.default.create({
        xsrfCookieName: 'csrftoken',
    });
    clientTW.defaults.withCredentials = false;
    return clientTW;
};
const clientTW = getAxiosClientTW();
let csrfmiddlewaretokenTW = '';
let csrftoken = '';
let sessionidTW = '';
const parseProfileTW = async (html) => {
    // Parse profile except for solved challs.
    const { fetchedBasicProfiles } = scrape_it_1.default.scrapeHTML(html, {
        fetchedBasicProfiles: {
            listItem: 'div.col-md-8 > div.row > div.col-md-9',
            data: {
                username: {
                    selector: 'div.row > div.col-md-10',
                    eq: 0,
                },
                country: {
                    selector: 'div.row > div.col-md-10',
                    eq: 1,
                },
                rank: {
                    selector: 'div.row > div.col-md-10',
                    eq: 2,
                },
                score: {
                    selector: 'div.row > div.col-md-10',
                    eq: 3,
                },
                comment: {
                    selector: 'div.row > div.col-md-10',
                    eq: 4,
                },
                registeredAt: {
                    selector: 'div.row > div.col-md-10',
                    eq: 5,
                },
            },
        },
    });
    const fetchedProfile = {
        ...fetchedBasicProfiles[0],
    };
    // Parse solved challs.
    const { solvedChalls } = await scrape_it_1.default.scrapeHTML(html, {
        solvedChalls: {
            listItem: 'table > tbody > tr',
            data: {
                id: {
                    selector: 'td > a',
                    attr: 'href',
                    convert: (urlChallenge) => urlChallenge.substring('/challenge/#'.length, urlChallenge.lenth),
                },
                name: {
                    selector: 'td > a',
                },
                solvedAt: {
                    selector: 'td',
                    eq: 3,
                    convert: (strDate) => new Date(strDate),
                },
                score: {
                    selector: 'td',
                    eq: 2,
                    convert: (strScore) => Number(strScore),
                },
            },
        },
    });
    fetchedProfile.solvedChalls = solvedChalls;
    return fetchedProfile;
};
const getCsrfsTW = (res) => {
    const html = res.data;
    const candMiddle = html.match((/<input type="hidden" name="csrfmiddlewaretoken" value="([A-Za-z0-9]+)">/))[1];
    csrfmiddlewaretokenTW = candMiddle ? candMiddle : csrfmiddlewaretokenTW;
    const candCsrf = String(res.headers['set-cookie']).split(' ')[0];
    csrftoken = candCsrf ? candCsrf : csrftoken;
};
const loginTW = async () => {
    // csrfmiddlewaretokenTW = null;
    // sessionidTW = null;
    const res1 = await clientTW.get('https://pwnable.tw/user/login');
    getCsrfsTW(res1);
    await clientTW.request({
        url: 'https://pwnable.tw/user/login',
        method: 'post',
        headers: {
            Cookie: csrftoken,
            Referer: 'https://pwnable.tw/',
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        maxRedirects: 0,
        data: querystring_1.default.stringify({
            csrfmiddlewaretoken: csrfmiddlewaretokenTW,
            username: process.env.PWNABLE_TW_USERNAME,
            password: process.env.PWNABLE_TW_PASSWORD,
        }),
    }).catch((data) => data.response.headers).then((headers) => {
        sessionidTW = String(headers['set-cookie'][1]).split(' ')[0];
    });
};
const fetchUserProfileTW = async function (userId) {
    await loginTW();
    try {
        const { data: html } = await clientTW.get(`https://pwnable.tw/user/${userId}`, {
            headers: {
                Cookie: sessionidTW,
            },
        });
        return await parseProfileTW(html);
    }
    catch {
        return null;
    }
};
exports.fetchUserProfileTW = fetchUserProfileTW;
// update challs and solved-state of pwnable.tw
const fetchChallsTW = async function () {
    // fetch data
    const { data: html } = await clientTW.get('https://pwnable.tw/challenge/', {
        headers: {},
    });
    const { fetchedChalls } = await scrape_it_1.default.scrapeHTML(html, {
        fetchedChalls: {
            listItem: 'li.challenge-entry',
            data: {
                name: {
                    selector: 'div.challenge-info > .title > p > .tititle',
                },
                score: {
                    selector: 'div.challenge-info > .title > p > .score',
                    convert: (strScore) => Number(strScore.substring(0, strScore.length - ' pts'.length)),
                },
                id: {
                    attr: 'id',
                    convert: (idStr) => Number(idStr.substring('challenge-id-'.length)),
                },
            },
        },
    });
    return fetchedChalls;
};
exports.fetchChallsTW = fetchChallsTW;
const parseUsersTW = async function (data) {
    const { parsedUsers } = await scrape_it_1.default.scrapeHTML(data, {
        parsedUsers: {
            listItem: 'table > tbody > tr',
            data: {
                userid: {
                    attr: 'data-href',
                },
                name: {
                    selector: 'td.name > strong',
                },
            },
        },
    });
    return parsedUsers;
};
// crawl for specified user and get userID
const findUserByNameTW = async function (username) {
    loginTW();
    let lastFetchedUser = null;
    let pageNum = 1;
    let safebar = 0; // to prevent DoS
    let fetchedUsers = [];
    while (safebar < SAFELIMIT) {
        const { data: html } = await clientTW.get(`https://pwnable.tw/user/rank?page=${pageNum}`, {
            headers: {},
        });
        fetchedUsers = await parseUsersTW(html);
        const foundUsers = fetchedUsers.filter((user) => user.name === username);
        if (foundUsers.length > 0) {
            return foundUsers[0];
        }
        if (lastFetchedUser && lastFetchedUser.userid === fetchedUsers[0].userid) {
            break;
        }
        lastFetchedUser = fetchedUsers[0];
        pageNum += 1;
        safebar += 1;
    }
    return null;
};
exports.findUserByNameTW = findUserByNameTW;
