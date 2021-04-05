import axios from 'axios';
import scrapeIt from 'scrape-it';
import {Challenge, SolvedInfo, Profile} from './BasicTypes';

const SAFELIMIT = 20;
const CACHE_UPDATE_INTERNAL = 12;

let cachedChalls: {
	updatedAt: Date,
	challs: Challenge[],
} = null;

const getAxiosClientKSN = () => {
	const clientKSN = axios.create();
	clientKSN.defaults.withCredentials = false;
	return clientKSN;
};

const clientKSN = getAxiosClientKSN();

const getDateKSN = (dateStr: string) => {
	const ymds = dateStr.split('/');
	const date = new Date();
	date.setFullYear(Number(ymds[0]));
	date.setMonth(Number(ymds[1]) - 1);
	date.setDate(Number(ymds[2]));
	date.setHours(23);
	date.setMinutes(59);
	return date;
};

const parseProfileKSN = (htmls: any[], userId: string) => {
	const re: RegExp = /<li>([0-9]{4}\/[0-9]{2}\/[0-9]{2}) @([^ ]+) solved ([0-9]+) (.*?)<\/li>/g;
	let results: RegExpExecArray = null;
	let solvedChalls: SolvedInfo[] = [];

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
		} as SolvedInfo));
	}

	const tmpscore = solvedChalls.reduce((total, chall) => total + Number(chall.score), 0);
	const fetchedProfile: Profile = {
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
const confirmChallsCache = async function() {
	if (needCacheUpdate()) {
		cachedChalls = {
			updatedAt: new Date(),
			challs: await fetchChallsKSN(),
		};
	}
};

export const fetchUserProfileKSN = async function(userId: string) {
	const htmls = await fetchAllKSN();
	await confirmChallsCache();
	return parseProfileKSN(htmls, userId);
};

// update challs and solved-state of ksnctf
export const fetchChallsKSN = async function() {
	// fetch information
	const {data: html} = await clientKSN.get('https://ksnctf.sweetduet.info', {
		headers: {},
	});
	const {fetchedChalls} = await scrapeIt.scrapeHTML<{ fetchedChalls: Challenge[] }>(html, {
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
					convert: (s: string) => Number(s),
				},
			},
		},
	});

	return fetchedChalls.filter((chall) => chall.name !== '');
};

// crawl for specified user and get userID
export const findUserByNameKSN = async function (username: string): Promise<{userid: string, name: string}> {
	const userProfile = await fetchUserProfileKSN(username);
	if (userProfile === null) {
		return null;
	}
	return {userid: username, name: username};
};

const fetchAllKSN = async function () {
	let SAFEBAR = 0;
	const htmls = [];

	// fetch all information
	while (SAFEBAR < SAFELIMIT) {
		try {
			const {data: html} = await clientKSN.get(`https://ksnctf.sweetduet.info/log?page=${SAFEBAR}`, {
				headers: {},
			});
			htmls.push(html);
		} catch {
			break;
		}
		SAFEBAR += 1;
	}
	return htmls;
};
