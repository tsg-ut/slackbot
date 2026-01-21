"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.findUserByNameKSN = exports.fetchChallsKSN = exports.fetchUserProfileKSN = void 0;
const axios_1 = __importDefault(require("axios"));
const scrape_it_1 = __importDefault(require("scrape-it"));
const SAFELIMIT = 20;
const CACHE_UPDATE_INTERNAL = 12;
let cachedChalls = null;
const getAxiosClientKSN = () => {
    const clientKSN = axios_1.default.create();
    clientKSN.defaults.withCredentials = false;
    return clientKSN;
};
const clientKSN = getAxiosClientKSN();
const getDateKSN = (dateStr) => {
    const ymds = dateStr.split('/');
    const date = new Date(Number(ymds[0]), Number(ymds[1]) - 1, Number(ymds[2]), 23, 59);
    return date;
};
const parseProfileKSN = (htmls, userId) => {
    const re = /<li>([0-9]{4}\/[0-9]{2}\/[0-9]{2}) @([^ ]+) solved ([0-9]+) (.*?)<\/li>/g;
    let results = null;
    let solvedChalls = [];
    for (const html of htmls) {
        while ((results = re.exec(html)) !== null) {
            if (results[2] === userId) {
                solvedChalls.push({
                    id: results[3],
                    solvedAt: getDateKSN(results[1]),
                    name: results[4],
                    score: 0,
                });
            }
        }
    }
    if (solvedChalls.length === 0) {
        return null;
    }
    if (cachedChalls !== null) {
        solvedChalls = solvedChalls.map((chall) => ({
            ...chall,
            score: cachedChalls.challs.find((c) => c.id === chall.id).score,
        }));
    }
    const tmpscore = solvedChalls.reduce((total, chall) => total + Number(chall.score), 0);
    const fetchedProfile = {
        username: userId,
        country: 'JP',
        rank: 'unknown',
        score: tmpscore !== 0 ? String(tmpscore) : 'unknown',
        comment: '',
        registeredAt: 'none',
        solvedChalls,
    };
    return fetchedProfile;
};
const needCacheUpdate = function () {
    if (cachedChalls === null) {
        return true;
    }
    if (Date.now() - cachedChalls.updatedAt.getTime() >= CACHE_UPDATE_INTERNAL * 60 * 60 * 1000) {
        return true;
    }
    return false;
};
//  ksnctf doesn't have user-profile. Therefore, you can't know
// the score of challs the user solved. However, checking the score
// everytime for each user is too heavy for the server of ksnctf.
// Hence, you cache the challs and update it every 12 hours.
const confirmChallsCache = async function () {
    if (needCacheUpdate()) {
        cachedChalls = {
            updatedAt: new Date(),
            challs: await (0, exports.fetchChallsKSN)(),
        };
    }
};
const fetchUserProfileKSN = async function (userId) {
    const htmls = await fetchAllKSN();
    await confirmChallsCache();
    return parseProfileKSN(htmls, userId);
};
exports.fetchUserProfileKSN = fetchUserProfileKSN;
// update challs and solved-state of ksnctf
const fetchChallsKSN = async function () {
    // fetch information
    const { data: html } = await clientKSN.get('https://ksnctf.sweetduet.info', {
        headers: {},
    });
    const { fetchedChalls } = scrape_it_1.default.scrapeHTML(html, {
        fetchedChalls: {
            listItem: 'table > tbody > tr',
            data: {
                name: {
                    selector: 'td > a',
                    eq: 0,
                },
                id: {
                    selector: 'td.text-end',
                    eq: 0,
                },
                score: {
                    selector: 'td.text-end',
                    eq: 1,
                    convert: (s) => Number(s),
                },
            },
        },
    });
    return fetchedChalls.filter((chall) => chall.name !== '');
};
exports.fetchChallsKSN = fetchChallsKSN;
// crawl for specified user and get userID
const findUserByNameKSN = async function (username) {
    const userProfile = await (0, exports.fetchUserProfileKSN)(username);
    if (userProfile === null) {
        return null;
    }
    return { userid: username, name: username };
};
exports.findUserByNameKSN = findUserByNameKSN;
const fetchAllKSN = async function () {
    let SAFEBAR = 0;
    const htmls = [];
    // fetch all information
    while (SAFEBAR < SAFELIMIT) {
        try {
            const { data: html } = await clientKSN.get(`https://ksnctf.sweetduet.info/log?page=${SAFEBAR}`, {
                headers: {},
            });
            htmls.push(html);
        }
        catch {
            break;
        }
        SAFEBAR += 1;
    }
    return htmls;
};
