const download = require('download');
const decompress = require('decompress');
const parse = require('csv-parse');
const {promisify} = require('util');
const fs = require('fs');
const iconv = require('iconv-lite');
const {hiraganize} = require('japanese');

(async () => {
	const dictionary = [];
	const reader = fs.createReadStream('dict/entries.tsv');
	const parser = parse({
		delimiter: '\t',
		quote: null,
		skip_lines_with_error: true,
	});

	parser.on('data', ([word, ruby, description]) => {
		dictionary.push({ruby: hiraganize(ruby), word, description});
	})

	parser.on('end', () => {
		console.log(dictionary.length);
		const writer = fs.createWriteStream('dict/query.sql');
		const words = new Set();
		writer.write('CREATE TABLE words (word TEXT, ruby TEXT, description TEXT);\n')
		writer.write('BEGIN TRANSACTION;\n');
		for (const {ruby, word, description} of dictionary) {
			if (ruby.length !== 4) {
				continue;
			}
			words.add(ruby);
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
		console.log(words.size);
		const wordsWriter = fs.createWriteStream('crossword.txt');
		for (const ruby of words) {
			wordsWriter.write(ruby + '\n');
		}
		wordsWriter.end();
	});

	reader.pipe(parser);
})();
