import scrapeIt from 'scrape-it';
import {google, sheets_v4} from 'googleapis';
import 'dotenv/config';
import axios from 'axios';
import zip from 'lodash/zip.js';

const getSheetRows = (rangeText: string, sheets: sheets_v4.Sheets) => new Promise<string[][]>((resolve, reject) => {
	sheets.spreadsheets.values.get({
		spreadsheetId: '14zFQH_a8qqPIE2JnxUVMMfkS5YjJ1ltpnYaN7Z3mnjs',
		range: rangeText,
	}, (error, response) => {
		if (error) {
			reject(error);
		} else if (response.data.values) {
			resolve(response.data.values as string[][]);
		} else {
			reject(new Error('values not found'));
		}
	});
});

const setSheetRows = (rangeText: string, values: string[][], sheets: sheets_v4.Sheets) => new Promise<void>((resolve, reject) => {
	sheets.spreadsheets.values.update({
		spreadsheetId: '14zFQH_a8qqPIE2JnxUVMMfkS5YjJ1ltpnYaN7Z3mnjs',
		range: rangeText,
		valueInputOption: 'USER_ENTERED',
		requestBody: {
			range: rangeText,
			values,
		},
	}, (error) => {
		if (error) {
			reject(error);
		} else {
			resolve();
		}
	});
});

const args = process.argv.slice(2);

const mode = args[0];

if (mode === 'parse-kiite') {
	interface KiiteData {
		songs: {
			title: string,
			artist: string,
		}[],
	}
	const url = args[1];
	const data = await scrapeIt<KiiteData>(url, {
		songs: {
			listItem: '.col-playlist > li',
			data: {
				title: 'h3',
				artist: 'p.playlist-creator',
			},
		},
	});
	for (const song of data.data.songs) {
		console.log(`${song.title}\t\t${song.artist}`);
	}
}

const wait = (ms: number) => new Promise((resolve) => {setTimeout(resolve, ms)});

const searchRubyAndUrl = async (title: string) => {
	let ruby: string | null = null;

	interface SearchData {
		songs: {
			url: string,
			title: string,
		}[],
	}

	interface SongData {
		ruby: string,
		urls: {
			url: string,
		}[],
	}

	console.log(`[Utaten] Searching ${title}`);
	await wait(1000);
	const utatenSearchResult = await scrapeIt<SearchData>(`https://utaten.com/search?sort=popular_sort_asc&title=${encodeURIComponent(title)}`, {
		songs: {
			listItem: '.searchResult__title > a',
			data: {
				url: {
					attr: 'href',
				},
				title: 'h2',
			},
		},
	});

	if (utatenSearchResult.data.songs.length > 0) {
		const songUrl = utatenSearchResult.data.songs[0].url;

		console.log(`[Utaten] Found ${songUrl}`);
		await wait(1000);
		const utatenSongResult = await scrapeIt<SongData>(`https://utaten.com${songUrl}`, {
			ruby: '.newLyricTitle__kana',
			urls: {
				listItem: '.billboardSlide__thumb',
				data: {
					url: {
						selector: 'img',
						attr: 'src',
					},
				},
			},
		});

		if (utatenSongResult.data.ruby) {
			ruby = utatenSongResult.data.ruby.replace(/^よみ：/, '');
		}

		if (utatenSongResult.data.urls.length > 0) {
			const url = utatenSongResult.data.urls[0].url;
			if (url.startsWith('https://i.ytimg.com/vi/')) {
				const videoId = url
					.replace(/^https:\/\/i\.ytimg\.com\/vi\//, '')
					.split('/')[0];
				if (videoId) {
					return {
						ruby,
						url: `https://www.youtube.com/watch?v=${videoId}`,
					};
				}
			}
		}
	}

	if (args[1].startsWith('vocaloid')) {
		return {
			ruby: '',
			url: '',
		};
	}

	console.log(`[Hwiki] Searching ${title}`);
	const hwikiUrl = `https://w.atwiki.jp/hmiku/?cmd=wikisearch&andor=and&cmp=cmp&keyword=${encodeURIComponent(title)}`;

	await wait(1000);
	const hwikiBody = await axios.get(hwikiUrl, {
		headers: {
			'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
		},
	});
	
	const hwikiSearchResult = await scrapeIt.scrapeHTML<SearchData>(hwikiBody.data, {
		songs: {
			listItem: '.wikisearch + ul > li',
			data: {
				url: {
					selector: 'a',
					attr: 'data-link',
				},
				title: {
					selector: 'a',
					attr: 'title',
				},
			},
		},
	});

	for (const song of hwikiSearchResult.songs) {
		if (song.title) {
			const pageid = JSON.parse(song.url)?.query?.pageid;

			if (!pageid) {
				continue;
			}

			console.log(`[Hwiki] Found ${song.title} (pageid: ${pageid})`);
			await wait(1000);
			const hwikiSongBody = await axios.get(`https://w.atwiki.jp/hmiku/pages/${pageid}.html`, {
				headers: {
					'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
				},
			});
			
			const hwikiSongResult = await scrapeIt.scrapeHTML<SongData>(hwikiSongBody.data, {
				ruby: '#wikibody',
				urls: {
					listItem: '.plugin_youtube',
					data: {
						url: {
							selector: 'iframe',
							attr: 'src',
						},
					},
				},
			});

			if (!ruby) {
				ruby = hwikiSongResult.ruby.match(/^曲名.+[(（](.+?)[)）]/m)?.[1] ?? '';
			}

			if (hwikiSongResult.urls.length > 0) {
				const url = hwikiSongResult.urls[0].url;
				if (url.startsWith('https://www.youtube.com/embed/')) {
					const videoId = url
						.replace(/^https:\/\/www\.youtube\.com\/embed\//, '')
						.split('?')[0];
					if (videoId) {
						return {
							ruby,
							url: `https://www.youtube.com/watch?v=${videoId}`,
						};
					}
				}
			}
			break;
		}
	}

	return {
		ruby,
		url: '',
	}
};

const getChorusStartSeconds = async (url: string) => {
	console.log(`[Songle] Getting chorus start seconds for ${url}`);

	await wait(1000);
	const songleBody = await axios.get(`https://widget.songle.jp/api/v1/song/chorus.json?url=${encodeURIComponent(url)}`, {
		responseType: 'json',
		validateStatus: null,
	});

	if (songleBody.status !== 200) {
		return 0;
	}

	const chorusStartSeconds = songleBody.data?.chorusSegments?.[0]?.repeats?.[0]?.start;
	if (typeof chorusStartSeconds !== 'number') {
		return 0;
	}

	return chorusStartSeconds / 1000;
};

const getYoutubeTitle = async (url: string) => {
	console.log(`[Youtube] Getting title for ${url}`);

	await wait(1000);
	const youtubeBody = await axios.get(`https://www.youtube.com/oembed?url=${encodeURIComponent(url)}`, {
		responseType: 'json',
		validateStatus: null,
	});

	if (youtubeBody.status !== 200) {
		return '';
	}

	return youtubeBody?.data?.title;
}

if (mode === 'fill-info') {
	const playlist = args[1];

	const auth = await new google.auth.GoogleAuth({
		scopes: ['https://www.googleapis.com/auth/spreadsheets'],
	}).getClient();

	const sheets = google.sheets({version: 'v4', auth});

	const titles = await getSheetRows(`${playlist}!B3:B1000`, sheets);

	const rubies: string[] = [];
	const urls: string[] = [];
	const chorusStartSeconds: number[] = [];
	const youtubeTitles: string[] = [];
	
	for (const [title] of titles) {
		let ruby = '';
		let url = '';
		let startSeconds = 0;
		let youtubeTitle = '';

		try {
			if (title !== '') {
				const songData = await searchRubyAndUrl(title);
				ruby = songData.ruby;
				url = songData.url;

				console.log(`[Result] ${title} (${ruby}) <${url}>`);

				if (url) {
					youtubeTitle = await getYoutubeTitle(url);
					console.log(`[Youtube] Title: ${youtubeTitle}`);

					startSeconds = await getChorusStartSeconds(url);
					console.log(`[Songle] Chorus start seconds: ${startSeconds}`);
				}
			}
		} catch (error) {
			console.error(error);
		} finally {
			rubies.push(ruby);
			urls.push(url);
			chorusStartSeconds.push(startSeconds);
			youtubeTitles.push(youtubeTitle);
		}
	}

	await setSheetRows(`${playlist}!C3:C1000`, rubies.map((ruby) => [ruby]), sheets);
	await setSheetRows(
		`${playlist}!E3:H1000`,
		zip(urls, chorusStartSeconds, youtubeTitles)
			.map(([url, chorusStartSecond, youtubeTitle]) => [
				url,
				'0',
				chorusStartSecond.toFixed(2),
				youtubeTitle,
			]),
		sheets,
	);
}

if (mode === 'billboard') {
	const year = args[1];
	const playlist = `billboard${year}`;

	const auth = await new google.auth.GoogleAuth({
		scopes: ['https://www.googleapis.com/auth/spreadsheets'],
	}).getClient();

	const sheets = google.sheets({version: 'v4', auth});

	interface BillboardData {
		songs: {
			title: string,
			artist: string,
		}[],
	}

	const result = await scrapeIt<BillboardData>(`https://www.billboard-japan.com/charts/detail?a=hot100_year&year=${encodeURIComponent(year)}`, {
		songs: {
			listItem: '.ranklink + table > tbody > tr',
			data: {
				title: '.musuc_title',
				artist: '.artist_name',
			},
		},
	});

	const songs: {title: string, artist: string}[] = [];
	const rubies: string[] = [];
	const urls: string[] = [];
	const chorusStartSeconds: number[] = [];
	const youtubeTitles: string[] = [];
	
	for (const {title, artist} of result.data.songs) {
		if (title === '') {
			continue;
		}

		let ruby = '';
		let url = '';
		let startSeconds = 0;
		let youtubeTitle = '';

		try {
			if (title !== '') {
				const songData = await searchRubyAndUrl(title);
				ruby = songData.ruby;
				url = songData.url;

				console.log(`[Result] ${title} (${ruby}) <${url}>`);

				if (url) {
					youtubeTitle = await getYoutubeTitle(url);
					console.log(`[Youtube] Title: ${youtubeTitle}`);

					startSeconds = await getChorusStartSeconds(url);
					console.log(`[Songle] Chorus start seconds: ${startSeconds}`);
				}
			}
		} catch (error) {
			console.error(error);
		} finally {
			songs.push({title, artist});
			rubies.push(ruby);
			urls.push(url);
			chorusStartSeconds.push(startSeconds);
			youtubeTitles.push(youtubeTitle);
		}
	}

	await setSheetRows(`${playlist}!C3:C1000`, rubies.map((ruby) => [ruby]), sheets);
	await setSheetRows(
		`${playlist}!B3:H1000`,
		zip(songs, rubies, urls, chorusStartSeconds, youtubeTitles)
			.map(([{title, artist}, ruby, url, chorusStartSecond, youtubeTitle]) => [
				title,
				ruby,
				artist,
				url,
				'0',
				chorusStartSecond.toFixed(2),
				youtubeTitle,
			]),
		sheets,
	);
}