import qs from 'querystring';
import axios, {AxiosResponse} from 'axios';
import scrapeIt from 'scrape-it';
import {Challenge, SolvedInfo, Profile} from './BasicTypes';

const SAFELIMIT = 100;

const getAxiosClientXYZ = () => {
	const clientXYZ = axios.create({
		xsrfCookieName: 'csrftoken',
	});
	clientXYZ.defaults.withCredentials = false;
	return clientXYZ;
};

const clientXYZ = getAxiosClientXYZ();
let csrfmiddlewaretokenXYZ = '';
let csrftokenXYZ = '';
let sessionidXYZ = '';

const getCsrfsXYZ = (res: AxiosResponse) => {
	const html = res.data;
	const candMiddle = html.match(/<input type="hidden" name="csrfmiddlewaretoken" value="([A-Za-z0-9]+)">/)[1];
	csrfmiddlewaretokenXYZ = candMiddle ? candMiddle : csrfmiddlewaretokenXYZ;

	const candCsrf = String(res.headers['set-cookie']).split(' ')[0];
	csrftokenXYZ = candCsrf ? candCsrf : csrftokenXYZ;
};

const loginXYZ = async () => {
	const res1 = await clientXYZ.get('https://pwnable.xyz/login');
	getCsrfsXYZ(res1);
	await clientXYZ.request({
		url: 'https://pwnable.xyz/login/',
		method: 'post',
		headers: {
			Cookie: csrftokenXYZ,
			Referer: 'https://pwnable.xyz/',
			'Content-Type': 'application/x-www-form-urlencoded',
		},
		maxRedirects: 0,
		data:
			qs.stringify({
				csrfmiddlewaretoken: csrfmiddlewaretokenXYZ,
				username: process.env.PWNABLE_XYZ_USERNAME,
				password: process.env.PWNABLE_XYZ_PASSWORD,
			}),
	}).catch((data) => data.response.headers).then((headers) => {
		sessionidXYZ = String(headers['set-cookie'][1]).split(' ')[0];
	});
};

// parse as UTC and return Date as UTC
const str2dateXYZ = (strDate: string): Date => {
	const strmons = ['Jan.', 'Feb.', 'March', 'April', 'May', 'June', 'July', 'Aug.', 'Sept.', 'Oct.', 'Nov', 'Dec.'];

	// format is like: Jan. 7, 2019, 7:46 a.m.
	const elements = strDate.split(' ');
	if (elements.length <= 1) {
		return null;
	}
	const month = (`00${String(strmons.indexOf(elements[0]))}`).slice(-2); // month is 0-indexed
	const day = (`00${elements[1].substring(0, elements[1].length - 1)}`).slice(-2);
	const year = elements[2].substring(0, elements[2].length - 1);
	const hour = (`00${elements[3].split(':')[0]}`).slice(-2);
	let minute: string = null;
	if (elements[3].includes(':')) {
		minute = (`00${elements[3].split(':')[1]}`).slice(-2);
	} else {
		minute = '00';
	}
	const seconds = '00';

	const resDate = new Date(Date.UTC(Number(year), Number(month), Number(day), Number(hour), Number(minute), Number(seconds)));
	return resDate;
};

const parseProfileXYZ = async (html: any) => {
	// Parse profile except for solved challs.
	const {fetchedBasicProfiles} = await scrapeIt.scrapeHTML<{ fetchedBasicProfiles: Profile[] }>(html, {
		fetchedBasicProfiles: {
			listItem: 'div.col-md-4',
			data: {
				username: {
					selector: 'h5.title',
				},
				rank: {
					selector: 'h6.description',
					convert: (rawstr: string) => rawstr.substring('Rank: '.length),
				},
				comment: {
					selector: 'h6.card-description',
				},
				registeredAt: {
					selector: 'h5.title',
					// eslint-disable-next-line no-unused-vars
					convert: (hoge) => new Date(),
				},
			},
		},
	});
	const fetchedProfile: Profile = {
		...fetchedBasicProfiles[0],
	};

	// Parse solved challs.
	const {solvedChalls} = await scrapeIt.scrapeHTML<{ solvedChalls: SolvedInfo[] }>(html, {
		solvedChalls: {
			listItem: 'table > tbody > tr',
			data: {
				id: {
					selector: 'td',
					eq: 0,
				},
				name: {
					selector: 'td',
					eq: 1,
				},
				score: {
					selector: 'td',
					eq: 2,
					convert: (strScore) => Number(strScore),
				},
				solvedAt: {
					selector: 'td',
					eq: 3,
					convert: (strDate: string) => str2dateXYZ(strDate),
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

	fetchedProfile.solvedChalls = solvedChalls;
	return fetchedProfile;
};

export const fetchUserProfileXYZ = async function(userId: string) {
	await loginXYZ();
	try {
		const {data: html} = await clientXYZ.get(`https://pwnable.xyz/user/${userId}/`, {
			headers: {
				Cookie: sessionidXYZ,
			},
		});
		return await parseProfileXYZ(html);
	} catch {
		return null;
	}
};

// update challs and solved-state of pwnable.xyz
export const fetchChallsXYZ = async function () {
	// fetch data
	const {data: html} = await axios.get('https://pwnable.xyz/challenges', {
		headers: {},
	});
	const {fetchedChalls} = await scrapeIt.scrapeHTML<{ fetchedChalls: Challenge[] }>(html, {
		fetchedChalls: {
			listItem: 'div.col-lg-2',
			data: {
				name: {
					selector: 'div.challenge > i',
				},
				score: {
					selector: 'div.challenge > p',
					convert: (strScore) => Number(strScore),
				},
				id: {
					selector: 'a',
					attr: 'data-target',
					convert: (idStr) => Number(idStr.substring('#chalModal'.length)),
				},
			},
		},
	});

	return fetchedChalls;
};

const parseUsersXYZ = async function(data: any): Promise<{userid: string, name: string}[]> {
	const {parsedUsers} = await scrapeIt.scrapeHTML<{ parsedUsers: { userid: string, name: string }[] }>(data, {
		parsedUsers: {
			listItem: 'div.content > div.row > div.col-lg-12 > table > tbody > tr',
			data: {
				userid: {
					attr: 'data-href',
					convert: (rawstr) => rawstr.substring('/user/'.length, rawstr.length - 1),
				},
				name: {
					selector: 'td.text-center',
					eq: 1,
				},
			},
		},
	});

	return parsedUsers;
};

// crawl for specified user and get userID
export const findUserByNameXYZ = async function (username: string): Promise<{userid: string, name: string}> {
	loginXYZ();
	let lastFetchedUser: {userid: string, name: string } = null;
	let pageNum = 1;
	let safebar = 0; // to prevent DoS
	let fetchedUsers: {userid: string, name: string}[] = [];

	while (safebar < SAFELIMIT) {
		const {data: html} = await clientXYZ.get(`https://pwnable.xyz/leaderboard/?page=${pageNum}`, {
			headers: {},
		});
		fetchedUsers = await parseUsersXYZ(html);
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
