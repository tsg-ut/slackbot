const fs = require('fs');
const path = require('path');
const {hiraganize} = require('japanese');

const data = fs.readFileSync(path.join(__dirname, '../wordhero/dict/kojien.txt'));
const lines = data.toString().split('\r\n');

const normalizeMeaning = (input) => {
	let meaning = input;
	meaning = meaning.replace(/\s*\[.+?\]\s*/g, '');
	meaning = meaning.replace(/\s*\(.+?\)\s*/g, '');
	meaning = meaning.replace(/（[^（）]+?）/g, '');
	meaning = meaning.replace(/（.+?）/g, '');
	meaning = meaning.replace(/【.+?】/g, '');
	meaning = meaning.replace(/〔.+?〕/g, '');
	meaning = meaning.replace(/。[^」』].*$/, '');
	if (meaning.includes('とは、')) {
		meaning = meaning.replace(/^.*?とは、/, '');
	} else if (meaning.includes('とは，')) {
		meaning = meaning.replace(/^.*?とは，/, '');
	} else if (meaning.includes('は、')) {
		meaning = meaning.replace(/^.*?は、/, '');
	} else if (meaning.includes('とは')) {
		meaning = meaning.replace(/^.*?とは/, '');
	}
	meaning = meaning.replace(/であり、.+$/, '');
	meaning = meaning.replace(/であるが、.+$/, '');
	meaning = meaning.replace(/のこと(?!わざ).+$/, '');
	meaning = meaning.replace(/を指す.+$/, '');
	meaning = meaning.replace(/^== (.+?) ==$/g, '$1');
	meaning = meaning.replace(/^\*/, '');
	meaning = meaning.replace(/^[\d０-９][\.．\s]/, '');
	meaning = meaning.trim().replace(/(のこと|の事|をいう|である|です|を指す|とされ(る|ます)|とされてい(る|ます)|、|。)+$/, '');
	meaning = meaning.replace(/(の一つ|のひとつ|の１つ)$/, 'の1つ');
	meaning = meaning.replace(/(の1人|のひとり|の１人)$/, 'の一人');
	meaning = meaning.replace(/(の1種|の１種)$/, 'の一種');
	return meaning.trim();
};

let ruby = null;
let word = null;
let matches = null;
const words = [];
for (const line of lines) {
	if (line.length === 0) {
		continue;
	}
	if (!line.startsWith(' ')) {
		let tempRuby = null;
		let tempWord = null;
		if (!line.includes('【') && (matches = line.match(/\p{Script=Hiragana}\p{Script=Katakana}/u))) {
			tempWord = line.slice(0, matches.index + 1).replace(/[‐・・]/g, '');
			tempRuby = hiraganize(tempWord).replace(/[‐・・]/g, '');
		} else {
			tempRuby = hiraganize(line.split(/[【‥]/)[0].replace(/[‐・]/g, ''));
			if (line.includes('【')) {
				tempWord = line.split(/[【】]/g)[1].split('・')[0];
			} else {
				tempWord = line.split(/[【‥]/)[0].replace(/[‐・・]/g, '');
			}
		}
		if (tempRuby.match(/^\p{Script_Extensions=Hiragana}+$/u)) {
			ruby = tempRuby;
			word = tempWord.replace(/\[.+?\]/g, '〓').replace(/ (ドイツ|フランス|ギリシア|アラビア|ラテン|アメリカ|スペイン|アフリカーンス|デンマーク|ヒンディー|イタリア|トルコ|イギリス|オランダ|ポルトガル|ロシア|モンゴル|インドネシア|マレー|チェコ|タイ|スウェーデン|ヘブライ|ペルシア|クメール|フラマン|ベトナム|カンボジア|エスペラント|カタルニア|イラン|ノルウェー|フィンランド|ビルマ|パーリ|タガログ|ハンガリー|ポーランド|ハワイ|アイヌ|チベット|ルーマニア|ダリー|チペット|梵)$/, '');
		} else {
			ruby = null;
			word = null;
		}
	} else {
		if (line.includes('：')) {
			words.pop();
			continue;
		}
		if (ruby === null || line.includes('【')) {
			continue;
		}
		const meaning = normalizeMeaning(line.replace(/^\s+/, ''));
		if (meaning.length === 0) {
			continue;
		}
		if (['連体', '副', '感', '形', '動', '名', '代', '形シク', '形ク', '接頭', '他', '枕'].includes(meaning) || meaning.match(/^(自|他|自他)(下一|下二|上一|上二|サ変|四|五)$/)) {
			continue;
		}
		words.push({word, ruby, meaning});
	}
}

for (const {word, ruby, meaning} of words) {
	process.stdout.write(`${word}\t${ruby}\t${meaning}\n`);
}