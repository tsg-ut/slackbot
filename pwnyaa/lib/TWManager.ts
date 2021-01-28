import qs from 'querystring';
import axios, {AxiosResponse} from 'axios';
import scrapeIt from 'scrape-it';
import {Challenge, SolvedInfo} from './BasicTypes';

export interface profileTW{
  username: string,
  country: string,
  rank: string,
  score: string,
  comment: string,
  registeredAt: string,
  solvedChalls: SolvedInfo[],
}

const getAxiosClientTW = () => {
	const clientTW = axios.create({
		xsrfCookieName: 'csrftoken',
	});
	clientTW.defaults.withCredentials = false;
	return clientTW;
};

const clientTW = getAxiosClientTW();
let csrfmiddlewaretokenTW = '';
let csrftoken = '';
let sessionidTW = '';

const parseProfileTW = async (html: any) => {
	// Parse profile except for solved challs.
	const {fetchedBasicProfiles} = await scrapeIt.scrapeHTML<{ fetchedBasicProfiles: profileTW[] }>(html, {
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
	const fetchedProfile: profileTW = {
		...fetchedBasicProfiles[0],
	};

	// Parse solved challs.
	const {solvedChalls} = await scrapeIt.scrapeHTML<{ solvedChalls: SolvedInfo[] }>(html, {
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


const getCsrfsTW = (res: AxiosResponse) => {
	const html = res.data;
	const candMiddle = html.match((/ {3}<input type='hidden' name='csrfmiddlewaretoken' value='([A-Za-z0-9]+)' \/>/))[1];
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
		data:
			qs.stringify({
				csrfmiddlewaretoken: csrfmiddlewaretokenTW,
				username: process.env.PWNABLE_TW_USERNAME,
				password: process.env.PWNABLE_TW_PASSWORD,
			}),
	}).catch((data) => data.response.headers).then((headers) => {
		sessionidTW = String(headers['set-cookie'][1]).split(' ')[0];
	});
};

export const fetchUserProfileTW = async function(userId: string) {
	await loginTW();
	try {
		const {data: html} = await clientTW.get(`https://pwnable.tw/user/${userId}`, {
			headers: {
				Cookie: sessionidTW,
			},
		});
		return await parseProfileTW(html);
	} catch {
		return null;
	}
};

// update challs and solved-state of pwnable.tw
export const fetchChallsTW = async function() {
	// fetch data
	const {data: html} = await clientTW.get('https://pwnable.tw/challenge/', {
		headers: {},
	});
	const {fetchedChalls} = await scrapeIt.scrapeHTML<{ fetchedChalls: Challenge[] }>(html, {
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

const parseUsersTW = async function(data: any): Promise<{userid: string, name: string}[]> {
	const {parsedUsers} = await scrapeIt.scrapeHTML<{ parsedUsers: { userid: string, name: string }[] }>(data, {
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
export const findUserByNameTW = async function (username: string): Promise<{userid: string, name: string}> {
	loginTW();
	let lastFetchedUser: {userid: string, name: string } = null;
	let pageNum = 1;
	let fetchedUsers: {userid: string, name: string}[] = [];

	while (true) {
		const {data: html} = await clientTW.get(`https://pwnable.tw/user/rank?page=${pageNum}`, {
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
	}
	return null;
};
