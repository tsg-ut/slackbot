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
			dictionary.set(hiraganize(読み), {word: 表層形, description: ''});
		}
		if (品詞1 === '動詞' && 活用形 === '基本形') {
			dictionary.set(hiraganize(読み), {word: 表層形, description: ''});
		}
		if (品詞1 === '形容詞' && 活用形 === '基本形') {
			dictionary.set(hiraganize(読み), {word: 表層形, description: ''});
		}
	});

	parser.on('end', () => {
		console.log(dictionary.size);
		const reader = fs.createReadStream('dict/entries-all.tsv');
		const parser = parse({
			delimiter: '\t',
			quote: null,
			skip_lines_with_error: true,
		});

		parser.on('data', ([word, ruby, description]) => {
			dictionary.set(hiraganize(ruby), {word, description});
		})

		parser.on('end', () => {
			console.log(dictionary.size);
			const writer = fs.createWriteStream('dict/naistdic.sql');
			const wordsWriter = fs.createWriteStream('words.txt');
			writer.write('CREATE TABLE words (word TEXT, ruby TEXT UNIQUE, description TEXT);\n')
			writer.write('BEGIN TRANSACTION;\n');
			for (const [ruby, {word, description}] of dictionary.entries()) {
				if (ruby.length > 16) {
					continue;
				}
				wordsWriter.write(ruby + '\n');
				writer.write(`INSERT INTO words VALUES ('${
					word.replace(/\t/g, '').replace(/(['])/g, '\'$1')
				}', '${
					ruby.replace(/(['])/g, '\'$1')
				}', '${
					description.replace(/(['])/g, '\'$1')
				}');\n`)
			}
			writer.write('COMMIT;');
			writer.end();
			wordsWriter.end();
		});

		reader.pipe(parser);
	});

	reader.pipe(decoder).pipe(encoder).pipe(parser);
})();
