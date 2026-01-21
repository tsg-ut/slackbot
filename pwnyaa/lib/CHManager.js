"use strict";
// Fetching Library For Crypthack
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.findUserByNameCH = exports.fetchChallsCH = exports.collectDaimonCH = exports.fetchUserProfileCH = void 0;
const querystring_1 = __importDefault(require("querystring"));
const axios_1 = __importDefault(require("axios"));
const scrape_it_1 = __importDefault(require("scrape-it"));
const getAxiosClientCH = () => {
    const clientCH = axios_1.default.create({});
    clientCH.defaults.withCredentials = false;
    return clientCH;
};
const clientCH = getAxiosClientCH();
let csrftokenCH = '';
let tempCookie = '';
let sessionidCH = '';
const getCsrfsCH = (res) => {
    const html = res.data;
    const candCsrf = html.match(/<input name="_csrf_token" type="hidden" value="([A-Za-z0-9]+)" \/>/)[1];
    const candCookie = String(res.headers['set-cookie']).split(' ')[0];
    csrftokenCH = candCsrf ? candCsrf : csrftokenCH;
    tempCookie = candCookie ? candCookie : tempCookie;
};
const loginCH = async () => {
    const res1 = await clientCH.get('https://cryptohack.org/login/');
    getCsrfsCH(res1);
    await clientCH.request({
        url: 'https://cryptohack.org/login/',
        method: 'post',
        headers: {
            Cookie: tempCookie,
            Referer: 'https://cryptohack.org',
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        maxRedirects: 0,
        data: querystring_1.default.stringify({
            username: process.env.PWNABLE_CH_USERNAME,
            password: process.env.PWNABLE_CH_PASSWORD,
            _csrf_token: csrftokenCH,
        }),
    }).catch((data) => data.response.headers).then((headers) => {
        sessionidCH = String(headers['set-cookie'][0]).split(' ')[0];
    });
};
const parseProfileCH = async (html) => {
    // Parse profile except for solved challs.
    const fetchedBasicProfile = scrape_it_1.default.scrapeHTML(html, {
        username: {
            selector: 'div.categoryTitle > h1',
        },
        country: {
            selector: 'div.userPoints > p > a > i',
            attr: 'class',
            convert: (strCountry) => {
                const tmpstr = strCountry.split(' ')[1];
                try {
                    return tmpstr.substring('flag-icon-'.length);
                }
                catch {
                    return 'unknown';
                }
            },
        },
        rank: {
            selector: 'div.userPoints > p',
            eq: 1,
            convert: (strScore) => strScore.substring('Rank: #'.length),
        },
        registeredAt: {
            selector: 'div.userPoints > p',
            eq: 0,
            convert: (strJoin) => {
                const tmpstr = strJoin.substring('Joined: '.length);
                return new Date(tmpstr);
            },
        },
    });
    const fetchedProfile = {
        ...fetchedBasicProfile,
    };
    // Parse solved challs.
    const { solvedChalls } = await scrape_it_1.default.scrapeHTML(html, {
        solvedChalls: {
            listItem: 'div.recentUserSolves > table > tbody > tr',
            data: {
                name: {
                    selector: 'td',
                    eq: 2,
                },
                score: {
                    selector: 'td',
                    eq: 3,
                    convert: (strScore) => Number(strScore),
                },
                solvedAt: {
                    selector: 'td > span',
                    eq: 0,
                    convert: (strDate) => new Date(strDate),
                },
            },
        },
    });
    // count score
    let sumScore = 0;
    for (const chall of solvedChalls) {
        sumScore += chall.score;
    }
    fetchedProfile.score = String(sumScore);
    fetchedProfile.comment = '';
    fetchedProfile.solvedChalls = solvedChalls;
    return fetchedProfile;
};
// NOTE: no need to login
const fetchUserProfileCH = async function (userId) {
    try {
        const { data: html } = await clientCH.get(`https://cryptohack.org/user/${userId}/`, {
            headers: {},
        });
        return await parseProfileCH(html);
    }
    catch {
        return null;
    }
};
exports.fetchUserProfileCH = fetchUserProfileCH;
// fetch URL for each Daimon
// NOTE: no need to login
const collectDaimonCH = async function () {
    const { data: html } = await axios_1.default.get('https://cryptohack.org/challenges/', {
        headers: {},
    });
    const { partUrls } = await scrape_it_1.default.scrapeHTML(html, {
        partUrls: {
            listItem: 'ul.listCards > a',
            data: {
                url: {
                    attr: 'href',
                    convert: (partUrl) => `https://cryptohack.org${partUrl}`,
                },
            },
        },
    });
    return partUrls.map((partUrl) => partUrl.url);
};
exports.collectDaimonCH = collectDaimonCH;
// update challs and solved-state of cryptohack.org
// NOTE: need to login
const fetchChallsCH = async function () {
    // fetch Daimon-s
    const daimonUrls = await (0, exports.collectDaimonCH)();
    let fetchedChalls = [];
    await loginCH();
    // fetch challs for each Daimon-s
    for (const url of daimonUrls) {
        const { data: html } = await axios_1.default.get(String(url), {
            headers: {
                Cookie: sessionidCH,
            },
        });
        const genreName = await scrape_it_1.default.scrapeHTML(html, {
            name: 'h2.categoryTitle',
        }).name;
        const { fetchedGenreChalls } = scrape_it_1.default.scrapeHTML(html, {
            fetchedGenreChalls: {
                listItem: 'li.challenge',
                data: {
                    name: {
                        selector: 'div.challenge-text',
                        convert: (strName) => `${genreName}: ${strName}`,
                    },
                    score: {
                        selector: 'span.right',
                        convert: (strScore) => Number(strScore.split(' ')[0]),
                    },
                    id: {
                        attr: 'data-category',
                    },
                },
            },
        });
        fetchedChalls = fetchedChalls.concat(fetchedGenreChalls);
    }
    return fetchedChalls;
};
exports.fetchChallsCH = fetchChallsCH;
// crawl for specified user and get userID
// NOTE: no need to login
// NOTE: userid and name is identical
const findUserByNameCH = async function (username) {
    const { data: infojson } = await clientCH.get(`https://cryptohack.org/api/search_user/${username}.json`, {
        headers: {},
    });
    if (infojson.users.length > 0) {
        return {
            userid: infojson.users[0].username,
            name: infojson.users[0].username,
        };
    }
    return null;
};
exports.findUserByNameCH = findUserByNameCH;
