const download = require('download');
const decompress = require('decompress');
const parse = require('csv-parse');
const {promisify} = require('util');
const fs = require('fs');
const iconv = require('iconv-lite');
const {hiraganize} = require('japanese');

(async () => {
	/*
	await download('https://ja.osdn.net/dl/naist-jdic/mecab-naist-jdic-0.6.3b-20111013.tar.gz', 'dict', {
		extract: true,
		headers: {
			'User-Agent': 'curl/7.55.1',
		},
	});
	*/

	const parser = parse({
		quote: null,
		skip_lines_with_error: true,
	});
	const decoder = iconv.decodeStream('EUC-JP');
	const encoder = iconv.encodeStream('UTF-8');
	const reader = fs.createReadStream('dict/mecab-naist-jdic-0.6.3b-20111013/naist-jdic.csv');

	const dictionary = new Map();

	parser.on('data', ([表層形, , , , 品詞1, 品詞2, 品詞3, 品詞4, 活用, 活用形, 基本形, 読み, 発音]) => {
		if (品詞1 === '名詞') {
			dictionary.set(hiraganize(読み), 表層形);
		}
		if (品詞1 === '動詞' && 活用形 !== '基本形') {
			dictionary.set(hiraganize(読み), 表層形);
		}
		if (品詞1 === '形容詞' && 活用形 !== '基本形') {
			dictionary.set(hiraganize(読み), 表層形);
		}
	});

	parser.on('end', () => {
		console.log(dictionary.size);
		const writer = fs.createWriteStream('dict/naistdic.tsv');
		for (const [表層形, 読み] of dictionary.entries()) {
			writer.write(`${表層形.replace(/\t/g, '')}\t${読み.replace()}\n`)
		}
	});

	reader.pipe(decoder).pipe(encoder).pipe(parser);
})();
