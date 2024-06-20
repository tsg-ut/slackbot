import scrapeIt from 'scrape-it';
import {google, sheets_v4, youtube_v3} from 'googleapis';
import 'dotenv/config';
import axios from 'axios';
import zip from 'lodash/zip.js';
import range from 'lodash/range.js';
import assert from 'assert';

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

const wait = (ms: number) => new Promise((resolve) => {setTimeout(resolve, ms)});

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
	tags: string[],
}

const searchUtaten = async (title: string) => {
	let ruby: string | null = null;

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

	return {
		ruby,
		url: '',
	}
};

const searchHmiku = async (keyword: string, searchField: string | null) => {
	let ruby: string | null = null;
	let title: string | null = null;

	console.log(`[Hmiku] Searching ${keyword}`);

	await wait(1000);
	const hmikuBody = await axios.get('https://w.atwiki.jp/hmiku/', {
		params: {
			cmd: 'wikisearch',
			andor: 'and',
			cmp: 'cmp',
			keyword: keyword,
			...(searchField && {search_field: searchField}),
		},
		headers: {
			'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
		},
	});
	
	const hmikuSearchResult = await scrapeIt.scrapeHTML<SearchData>(hmikuBody.data, {
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

	for (const song of hmikuSearchResult.songs) {
		if (song.title) {
			title = song.title.split('/')[0];

			const pageid = JSON.parse(song.url)?.query?.pageid;

			if (!pageid) {
				continue;
			}

			console.log(`[Hmiku] Found ${title} (pageid: ${pageid})`);
			await wait(1000);
			const hmikuSongBody = await axios.get(`https://w.atwiki.jp/hmiku/pages/${pageid}.html`, {
				headers: {
					'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
				},
			});
			
			const hmikuSongResult = await scrapeIt.scrapeHTML<SongData>(hmikuSongBody.data, {
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
				tags: {
					listItem: '#wikibody h2 + div a',
				},
			});

			if (
				hmikuSongResult.tags.includes('作り手') ||
				hmikuSongResult.tags.includes('作曲家') ||
				hmikuSongResult.tags.includes('作詞家') ||
				hmikuSongResult.tags.includes('合成音声')
			) {
				console.log(`[Hmiku] Skip because of tag (${hmikuSongResult.tags.join(', ')})`);
				continue;
			}

			if (!ruby) {
				ruby = hmikuSongResult.ruby.match(/^曲名.+[(（](.+?)[)）]/m)?.[1] ?? '';
			}

			if (hmikuSongResult.urls.length > 0) {
				const url = hmikuSongResult.urls[0].url;
				if (url.startsWith('https://www.youtube.com/embed/')) {
					const videoId = url
						.replace(/^https:\/\/www\.youtube\.com\/embed\//, '')
						.split('?')[0];
					if (videoId) {
						return {
							ruby,
							title,
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
		title,
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

const getYoutubeTitleAndChannel = async (url: string) => {
	console.log(`[Youtube] Getting title for ${url}`);

	await wait(1000);
	const youtubeBody = await axios.get(`https://www.youtube.com/oembed?url=${encodeURIComponent(url)}`, {
		responseType: 'json',
		validateStatus: null,
	});

	if (youtubeBody.status !== 200) {
		return {
			title: '',
			channel: '',
		};
	}

	return {
		title: youtubeBody?.data?.title,
		channel: youtubeBody?.data?.author_name,
	};
}

if (mode === 'generate-vocaloid') {
	interface KiiteData {
		songs: {
			title: string,
			artist: string,
			nicovideoId: string,
		}[],
	}

	const auth = await new google.auth.GoogleAuth({
		scopes: ['https://www.googleapis.com/auth/spreadsheets'],
	}).getClient();

	const sheets = google.sheets({version: 'v4', auth});

	const url = args[1];
	const year = parseInt(args[2]);

	assert(url, 'URL must be specified');
	assert(year >= 2000, 'Year must be greater than or equal to 2000');

	const playlist = `vocaloid${year}`;

	const data = await scrapeIt<KiiteData>(url, {
		songs: {
			listItem: '.col-playlist > li',
			data: {
				title: 'h3',
				artist: 'p.playlist-creator',
				nicovideoId: {
					attr: 'data-thumbnail',
					convert: (thumbnail) => (
						`sm${thumbnail.split('/')[4] ?? ''}`
					),
				},
			},
		},
	});

	for (const [i, song] of data.data.songs.entries()) {
		let title = '';
		let ruby = '';
		let url = '';
		let startSeconds = 0;
		let youtubeTitle = '';
		let youtubeChannel = '';

		const hmikuInfo = await searchHmiku(song.nicovideoId, 'source');

		if (hmikuInfo.title) {
			title = hmikuInfo.title;
		}

		if (hmikuInfo.ruby) {
			ruby = hmikuInfo.ruby;
		}

		if (hmikuInfo.url) {
			url = hmikuInfo.url;
		}

		const utatenInfo = await searchUtaten(title);

		if (!ruby && utatenInfo.ruby) {
			ruby = utatenInfo.ruby;
		}

		if (!url && utatenInfo.url) {
			url = utatenInfo.url;
		}

		if (url) {
			const youtubeInfo = await getYoutubeTitleAndChannel(url);
			youtubeTitle = youtubeInfo.title;
			console.log(`[Youtube] Title: ${youtubeTitle}`);

			youtubeChannel = youtubeInfo.channel;
			console.log(`[Youtube] Channel: ${youtubeChannel}`);

			startSeconds = await getChorusStartSeconds(url);
			console.log(`[Songle] Chorus start seconds: ${startSeconds}`);
		}

		const rowNumber = i + 3;

		await setSheetRows(
			`${playlist}!B${rowNumber}:I${rowNumber}`,
			[[title, ruby, song.artist, url, '0', startSeconds.toFixed(2), youtubeTitle, youtubeChannel]],
			sheets,
		);
	}
}

if (mode === 'fill-info') {
	const playlist = args[1];
	const page = parseInt(args[2]) ?? 1;

	assert(page >= 1, 'Page must be greater than or equal to 1');
	assert(page <= 10, 'Page must be less than or equal to 10');

	const startCell = (page - 1) * 100 + 3;
	const endCell = page * 100 + 2;

	const auth = await new google.auth.GoogleAuth({
		scopes: ['https://www.googleapis.com/auth/spreadsheets'],
	}).getClient();

	const sheets = google.sheets({version: 'v4', auth});

	const titles = await getSheetRows(`${playlist}!B${startCell}:B${endCell}`, sheets);

	const rubies: string[] = [];
	const urls: string[] = [];
	const chorusStartSeconds: number[] = [];
	const youtubeTitles: string[] = [];
	const youtubeChannels: string[] = [];
	
	for (const [title] of titles) {
		let ruby = '';
		let url = '';
		let startSeconds = 0;
		let youtubeTitle = '';
		let youtubeChannel = '';

		try {
			if (title !== '') {
				const songData = await searchUtaten(title);
				ruby = songData.ruby;
				url = songData.url;

				console.log(`[Result] ${title} (${ruby}) <${url}>`);

				if (url) {
					const youtubeInfo = await getYoutubeTitleAndChannel(url);
					youtubeTitle = youtubeInfo.title;
					console.log(`[Youtube] Title: ${youtubeTitle}`);

					youtubeChannel = youtubeInfo.channel;
					console.log(`[Youtube] Channel: ${youtubeChannel}`);

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
			youtubeChannels.push(youtubeChannel);
		}
	}

	await setSheetRows(`${playlist}!C${startCell}:C${endCell}`, rubies.map((ruby) => [ruby]), sheets);
	await setSheetRows(
		`${playlist}!E${startCell}:I${endCell}`,
		zip(urls, chorusStartSeconds, youtubeTitles, youtubeChannels)
			.map(([url, chorusStartSecond, youtubeTitle, youtubeChannel]) => [
				url,
				'0',
				chorusStartSecond.toFixed(2),
				youtubeTitle,
				youtubeChannel,
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

	const pastYears = range(parseInt(year) + 1, 2024).map((year) => `billboard${year}`);
	assert(pastYears.length < 20, 'Too many past years');

	const pastSongs = new Map<string, string[]>();

	for (const pastYear of pastYears) {
		console.log(`[Past] Fetching ${pastYear}`);
		const sheetData = await getSheetRows(`${pastYear}!B3:I102`, sheets);

		for (const [title, ruby, artist, url, , chorusStartSecond, youtubeTitle] of sheetData) {
			if (title === '') {
				continue;
			}

			if (url) {
				pastSongs.set(title, [ruby, artist, url, chorusStartSecond, youtubeTitle]);
			}
		}
	}

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

	const songInfos: string[][] = [];
	
	for (const {title, artist} of result.data.songs) {
		if (title === '') {
			continue;
		}

		let ruby = '';
		let url = '';
		let startSeconds = 0;
		let youtubeTitle = '';
		let youtubeChannel = '';

		try {
			if (pastSongs.has(title)) {
				const [pastRuby, _pastArtist, pastUrl, pastChorusStartSecond, pastYoutubeTitle, pastYoutubeChannel] = pastSongs.get(title) ?? [];
				ruby = pastRuby;
				url = pastUrl;
				startSeconds = parseFloat(pastChorusStartSecond);
				youtubeTitle = pastYoutubeTitle;
				youtubeChannel = pastYoutubeChannel;
				console.log(`[Past] ${title} (${ruby}) <${url}>`);
			} else {
				const songData = await searchUtaten(title);
				ruby = songData.ruby;
				url = songData.url;

				console.log(`[Result] ${title} (${ruby}) <${url}>`);

				if (url) {
					const youtubeInfo = await getYoutubeTitleAndChannel(url);
					youtubeTitle = youtubeInfo.title;
					console.log(`[Youtube] Title: ${youtubeTitle}`);

					youtubeChannel = youtubeInfo.channel;
					console.log(`[Youtube] Channel: ${youtubeChannel}`);

					startSeconds = await getChorusStartSeconds(url);
					console.log(`[Songle] Chorus start seconds: ${startSeconds}`);
				}
			}
		} catch (error) {
			console.error(error);
		} finally {
			songInfos.push([title, artist, ruby, url, startSeconds.toFixed(2), youtubeTitle, youtubeChannel, ruby, url]);
		}
	}

	await setSheetRows(
		`${playlist}!B3:H102`,
		songInfos
			.map(([title, artist, ruby, url, chorusStartSecond, youtubeTitle, youtubeChannel]) => [
				title,
				ruby,
				artist,
				url,
				'0',
				chorusStartSecond,
				youtubeTitle,
				youtubeChannel,
			]),
		sheets,
	);
}

if (mode === 'youtube-playlist') {
	const playlistId = args[1];
	const sheetName = args[2]

	const auth = await new google.auth.GoogleAuth({
		scopes: [
			'https://www.googleapis.com/auth/spreadsheets',
			'https://www.googleapis.com/auth/youtube.readonly',
		],
	}).getClient();

	const sheets = google.sheets({version: 'v4', auth});

	const youtube = google.youtube({version: 'v3', auth});

	const items: youtube_v3.Schema$PlaylistItem[] = [];

	let pageToken: string | undefined = undefined;

	do {
		const playlistItems = await youtube.playlistItems.list({
			part: ['snippet'],
			playlistId,
			maxResults: 50,
			...(pageToken && {pageToken}),
		});

		items.push(...playlistItems.data.items ?? []);

		pageToken = playlistItems.data.nextPageToken;
	} while (pageToken);

	const songs: {title: string, artist: string}[] = [];
	const rubies: string[] = [];
	const urls: string[] = [];
	const chorusStartSeconds: number[] = [];
	const youtubeTitles: string[] = [];

	for (const {snippet} of items) {
		const title = snippet.title;
		const artist = snippet.videoOwnerChannelTitle;
		const url = `https://www.youtube.com/watch?v=${snippet.resourceId.videoId}`;

		let ruby = '';
		let startSeconds = 0;
		let youtubeTitle = '';

		try {
			if (url) {
				const {title} = await getYoutubeTitleAndChannel(url);
				youtubeTitle = title;
				console.log(`[Youtube] Title: ${youtubeTitle}`);

				startSeconds = await getChorusStartSeconds(url);
				console.log(`[Songle] Chorus start seconds: ${startSeconds}`);
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

	await setSheetRows(`${sheetName}!C3:C1000`, rubies.map((ruby) => [ruby]), sheets);
	await setSheetRows(
		`${sheetName}!B3:H1000`,
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
