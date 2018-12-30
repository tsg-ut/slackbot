const axios = require('axios');
const iconv = require('iconv-lite');
const cheerio = require('cheerio');
const cheerioTableparser = require('cheerio-tableparser');
const {unzip, head, tail, last} = require('lodash');
const japanese = require('japanese');

const pages = [
	'http://www.tt.rim.or.jp/~ishato/tiri/code/rireki/01hokkaido.htm',
	'http://www.tt.rim.or.jp/~ishato/tiri/code/rireki/02aomori.htm',
	'http://www.tt.rim.or.jp/~ishato/tiri/code/rireki/03iwate.htm',
	'http://www.tt.rim.or.jp/~ishato/tiri/code/rireki/04miyagi.htm',
	'http://www.tt.rim.or.jp/~ishato/tiri/code/rireki/05akita.htm',
	'http://www.tt.rim.or.jp/~ishato/tiri/code/rireki/06yamagata.htm',
	'http://www.tt.rim.or.jp/~ishato/tiri/code/rireki/07hukusima.htm',
	'http://www.tt.rim.or.jp/~ishato/tiri/code/rireki/08ibaraki.htm',
	'http://www.tt.rim.or.jp/~ishato/tiri/code/rireki/09totigi.htm',
	'http://www.tt.rim.or.jp/~ishato/tiri/code/rireki/10gunma.htm',
	'http://www.tt.rim.or.jp/~ishato/tiri/code/rireki/11saitama.htm',
	'http://www.tt.rim.or.jp/~ishato/tiri/code/rireki/12tiba.htm',
	'http://www.tt.rim.or.jp/~ishato/tiri/code/rireki/13tokyo.htm',
	'http://www.tt.rim.or.jp/~ishato/tiri/code/rireki/14kanagawa.htm',
	'http://www.tt.rim.or.jp/~ishato/tiri/code/rireki/15niigata.htm',
	'http://www.tt.rim.or.jp/~ishato/tiri/code/rireki/16toyama.htm',
	'http://www.tt.rim.or.jp/~ishato/tiri/code/rireki/17isikawa.htm',
	'http://www.tt.rim.or.jp/~ishato/tiri/code/rireki/18hukui.htm',
	'http://www.tt.rim.or.jp/~ishato/tiri/code/rireki/19yamanasi.htm',
	'http://www.tt.rim.or.jp/~ishato/tiri/code/rireki/20nagano.htm',
	'http://www.tt.rim.or.jp/~ishato/tiri/code/rireki/21gihu.htm',
	'http://www.tt.rim.or.jp/~ishato/tiri/code/rireki/22sizuoka.htm',
	'http://www.tt.rim.or.jp/~ishato/tiri/code/rireki/23aiti.htm',
	'http://www.tt.rim.or.jp/~ishato/tiri/code/rireki/24mie.htm',
	'http://www.tt.rim.or.jp/~ishato/tiri/code/rireki/25siga.htm',
	'http://www.tt.rim.or.jp/~ishato/tiri/code/rireki/26kyoto.htm',
	'http://www.tt.rim.or.jp/~ishato/tiri/code/rireki/27osaka.htm',
	'http://www.tt.rim.or.jp/~ishato/tiri/code/rireki/28hyogo.htm',
	'http://www.tt.rim.or.jp/~ishato/tiri/code/rireki/29nara.htm',
	'http://www.tt.rim.or.jp/~ishato/tiri/code/rireki/30wakayama.htm',
	'http://www.tt.rim.or.jp/~ishato/tiri/code/rireki/31tottori.htm',
	'http://www.tt.rim.or.jp/~ishato/tiri/code/rireki/32simane.htm',
	'http://www.tt.rim.or.jp/~ishato/tiri/code/rireki/33okayama.htm',
	'http://www.tt.rim.or.jp/~ishato/tiri/code/rireki/34hirosima.htm',
	'http://www.tt.rim.or.jp/~ishato/tiri/code/rireki/35yamaguti.htm',
	'http://www.tt.rim.or.jp/~ishato/tiri/code/rireki/36tokusima.htm',
	'http://www.tt.rim.or.jp/~ishato/tiri/code/rireki/37kagawa.htm',
	'http://www.tt.rim.or.jp/~ishato/tiri/code/rireki/38ehime.htm',
	'http://www.tt.rim.or.jp/~ishato/tiri/code/rireki/39koti.htm',
	'http://www.tt.rim.or.jp/~ishato/tiri/code/rireki/40hukuoka.htm',
	'http://www.tt.rim.or.jp/~ishato/tiri/code/rireki/41saga.htm',
	'http://www.tt.rim.or.jp/~ishato/tiri/code/rireki/42nagasaki.htm',
	'http://www.tt.rim.or.jp/~ishato/tiri/code/rireki/43kumamoto.htm',
	'http://www.tt.rim.or.jp/~ishato/tiri/code/rireki/44oita.htm',
	'http://www.tt.rim.or.jp/~ishato/tiri/code/rireki/45miyazaki.htm',
	'http://www.tt.rim.or.jp/~ishato/tiri/code/rireki/46kagosima.htm',
	'http://www.tt.rim.or.jp/~ishato/tiri/code/rireki/47okinawa.htm',
];

(async () => {
	for (const page of pages) {
		const {data} = await axios.get(page, {
			responseType: 'arraybuffer',
		});

		const $ = cheerio.load(iconv.decode(data, 'sjis'));
		cheerioTableparser($);
		const table = unzip($('table').parsetable(true, true, true));

		const prefecture = $('h2:nth-child(n+5)').text().split(/[：【】]/)[1].trim();

		const heads = head(table);
		const rawCities = tail(table);

		const cities = rawCities.map((rows) => ({
			status: rows.find((row, index) => heads[index] === '改廃'),
			names: rows.filter((row, index) => heads[index].includes('市郡') || heads[index].includes('区町村')),
			ruby: rows.find((row, index) => heads[index] === 'ふりがな'),
			changes: rows.filter((row, index) => heads[index] === '変更'),
		})).filter(({status, changes}) => (['削除', '変更'].includes(status) || ['改称', '町制', '市制', '村制', '合併', '編入'].includes(changes[1])) && changes[0].length > 0);

		for (const {names, ruby, changes} of cities) {
			console.log([
				prefecture,
				last(names.filter((name) => name)),
				japanese.katakanize(ruby),
				changes[0].split('.')[0],
			].join(','));
		}

		await new Promise((resolve) => setTimeout(resolve, 1000));
	}

	{
		const {data} = await axios.get('https://uub.jp/cpf/shometsu.html', {
			responseType: 'arraybuffer',
		});

		const $ = cheerio.load(iconv.decode(data, 'sjis'));
		cheerioTableparser($);
		const cities = unzip($('table').eq(3).parsetable(true, true, true))

		for (const [name, ruby, prefecture, , date] of cities) {
			const matches = date && date.match(/^(\d{4})/);
			if (!matches) {
				continue;
			}
			const year = matches[1];

			if (parseInt(year) >= 1960) {
				return;
			}

			console.log([
				prefecture,
				name,
				japanese.katakanize(ruby),
				year,
			].join(','));
		}
	}
})();
