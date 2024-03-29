// Fetching Library For Crypthack

import qs from 'querystring';
import axios, {AxiosResponse} from 'axios';
import scrapeIt from 'scrape-it';
import {Challenge, SolvedInfo, Profile} from './BasicTypes';

const getAxiosClientCH = () => {
	const clientCH = axios.create({
	});
	clientCH.defaults.withCredentials = false;
	return clientCH;
};

const clientCH = getAxiosClientCH();
let csrftokenCH = '';
let tempCookie = '';
let sessionidCH = '';

const getCsrfsCH = (res: AxiosResponse<string>) => {
	const html = res.data;
	const candCsrf = html.match(/<input name="_csrf_token" type="hidden" value="([A-Za-z0-9]+)" \/>/)[1];
	const candCookie = String(res.headers['set-cookie']).split(' ')[0];
	csrftokenCH = candCsrf ? candCsrf : csrftokenCH;
	tempCookie = candCookie ? candCookie : tempCookie;
};

const loginCH = async () => {
	const res1 = await clientCH.get<string>('https://cryptohack.org/login/');
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
		data:
			qs.stringify({
				username: process.env.PWNABLE_CH_USERNAME,
				password: process.env.PWNABLE_CH_PASSWORD,
				_csrf_token: csrftokenCH,
			}),
	}).catch((data) => data.response.headers).then((headers) => {
		sessionidCH = String(headers['set-cookie'][0]).split(' ')[0];
	});
};

const parseProfileCH = async (html: any) => {
	// Parse profile except for solved challs.
	const fetchedBasicProfile = scrapeIt.scrapeHTML<any>(html, {
		username: {
			selector: 'div.categoryTitle > h1',
		},
		country: {
			selector: 'div.userPoints > p > a > i',
			attr: 'class',
			convert: (strCountry: string) => {
				const tmpstr = strCountry.split(' ')[1];
				try {
					return tmpstr.substring('flag-icon-'.length);
				} catch {
					return 'unknown';
				}
			},
		},
		rank: {
			selector: 'div.userPoints > p',
			eq: 1,
			convert: (strScore: string) => strScore.substring('Rank: #'.length),
		},
		registeredAt: {
			selector: 'div.userPoints > p',
			eq: 0,
			convert: (strJoin: string) => {
				const tmpstr = strJoin.substring('Joined: '.length);
				return new Date(tmpstr);
			},
		},
	}) as Profile;
	const fetchedProfile: Profile = {
		...fetchedBasicProfile,
	};

	// Parse solved challs.
	const {solvedChalls} = await scrapeIt.scrapeHTML<{ solvedChalls: SolvedInfo[] }>(html, {
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
					convert: (strScore: string) => Number(strScore),
				},
				solvedAt: {
					selector: 'td > span',
					eq: 0,
					convert: (strDate: string) => new Date(strDate),
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
export const fetchUserProfileCH = async function(userId: string) {
	try {
		const {data: html} = await clientCH.get(`https://cryptohack.org/user/${userId}/`, {
			headers: {
			},
		});
		return await parseProfileCH(html);
	} catch {
		return null;
	}
};

// fetch URL for each Daimon
// NOTE: no need to login
export const collectDaimonCH = async function () {
	const {data: html} = await axios.get<string>('https://cryptohack.org/challenges/', {
		headers: {},
	});
	const {partUrls} = await scrapeIt.scrapeHTML<{ partUrls: {url: String}[] }>(html, {
		partUrls: {
			listItem: 'ul.listCards > a',
			data: {
				url: {
					attr: 'href',
					convert: (partUrl: String) => `https://cryptohack.org${partUrl}`,
				},
			},
		},
	});
	return partUrls.map((partUrl) => partUrl.url);
};

// update challs and solved-state of cryptohack.org
// NOTE: need to login
export const fetchChallsCH = async function () {
	// fetch Daimon-s
	const daimonUrls = await collectDaimonCH();
	let fetchedChalls: Challenge[] = [];

	await loginCH();

	// fetch challs for each Daimon-s
	for (const url of daimonUrls) {
		const {data: html} = await axios.get<string>(String(url), {
			headers: {
				Cookie: sessionidCH,
			},
		});
		const genreName: string = await scrapeIt.scrapeHTML<any>(html, {
			name: 'h2.categoryTitle',
		}).name;
		const {fetchedGenreChalls} = scrapeIt.scrapeHTML<{ fetchedGenreChalls: Challenge[] }>(html, {
			fetchedGenreChalls: {
				listItem: 'li.challenge',
				data: {
					name: {
						selector: 'div.challenge-text',
						convert: (strName: string) => `${genreName}: ${strName}`,
					},
					score: {
						selector: 'span.right',
						convert: (strScore: string) => Number(strScore.split(' ')[0]),
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

// crawl for specified user and get userID
// NOTE: no need to login
// NOTE: userid and name is identical
export const findUserByNameCH = async function (username: string): Promise<{userid: string, name: string}> {
	const {data: infojson} = await clientCH.get<any>(`https://cryptohack.org/api/search_user/${username}.json`, {
		headers: {},
	});
	if (infojson.users.length > 0) {
		return {
			userid: infojson.users[0].username as string,
			name: infojson.users[0].username as string,
		};
	}
	return null;
};
