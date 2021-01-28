import axios from 'axios';
import scrapeIt from 'scrape-it';
import {Challenge} from './BasicTypes';

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
