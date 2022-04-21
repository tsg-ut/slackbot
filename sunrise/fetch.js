const qs = require('querystring');
const axios = require('axios');
const cheerio = require('cheerio');
const {flatten, sortBy} = require('lodash');
const scrapeIt = require('scrape-it');

const getTayoriEntries = async () => {
	const {data} = await scrapeIt('http://www.i-nekko.jp/hibinotayori/', {
		articles: {
			listItem: 'section.blog-panel',
			data: {
				date: {
					selector: '.blog-date',
				},
				title: {
					selector: '.blog-title',
				},
				link: {
					selector: '.blog-title > a',
					attr: 'href',
				},
			},
		},
	});

	return data.articles;
};

const getSaijikiEntries = async () => {
	const {data} = await scrapeIt('http://www.i-nekko.jp/category.html', {
		archives: {
			listItem: '.archive-list',
			data: {
				category: {
					selector: '.archive-list-title > img',
					attr: 'alt',
				},
				articles: {
					listItem: '.archive-list-box',
					data: {
						date: {
							selector: '.date',
						},
						title: {
							selector: '.date + p',
						},
						link: {
							selector: 'a',
							attr: 'href',
						},
					},
				},
			},
		},
	});

	return sortBy(flatten(
		data.archives.map(({category, articles}) => (
			articles.map((article) => ({category, ...article}))
		)),
	), [({date}) => {
		const [year, month, day, time] = date.split(/[年月日]/).map((token) => token.trim());
		return new Date(`${year}-${month}-${day} ${time}`);
	}]).reverse();
};

const getTenkijpEntries = async () => {
	const {data} = await scrapeIt('https://tenki.jp/suppl/entries/1/', {
		articles: {
			listItem: '.recent-entries > ul > li',
			data: {
				title: {
					selector: '.recent-entries-title',
				},
				link: {
					selector: 'a',
					attr: 'href',
				},
			},
		},
	});

	return data.articles.map(({title, link}) => ({
		title,
		link: new URL(link, 'https://tenki.jp/').href,
	}));
};

const getEntries = () => (
	Promise.all([
		getTayoriEntries(),
		getSaijikiEntries(),
		getTenkijpEntries(),
	])
);

const getHaiku = async () => {
	const {data} = await axios.get('https://www.haijinkyokai.jp/');
	const $ = cheerio.load(data);
	$('rt').each((i, element) => {
		$(element).remove(); // Remove ruby
	});
	const text = $('#poem1').text();
	const author = $('#author').text();
	const note = $('#notes > p').text();

	return {text, author, note};
};

const getWeather = async (location) => {
	// Fetch location id of target location
	const {data: locationData} = await axios.get(`http://dataservice.accuweather.com/locations/v1/cities/geoposition/search?${qs.encode({
		apikey: process.env.ACCUWEATHER_KEY,
		q: location.join(','),
		details: 'true',
	})}`);
	const locationId = locationData.Key;

	const {data} = await axios.get(`http://dataservice.accuweather.com/forecasts/v1/daily/5day/${locationId}?${qs.encode({
		apikey: process.env.ACCUWEATHER_KEY,
		details: 'true',
	})}`);

	return {data, locationId};
};

module.exports = {getEntries, getHaiku, getWeather};
