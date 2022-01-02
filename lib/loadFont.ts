import * as opentype from 'opentype.js';
// @ts-expect-error
import download from 'download';
import path from 'path';
import fs from 'fs';
import * as _ from 'lodash';

const fontURLs = new Map<string, string>([
  ['Noto Serif JP Thin', 'https://github.com/googlefonts/noto-cjk/raw/main/Serif/OTF/Japanese/NotoSerifCJKjp-Thin.otf'],
  ['Noto Serif JP Light', 'https://github.com/googlefonts/noto-cjk/raw/main/Serif/OTF/Japanese/NotoSerifCJKjp-Light.otf'],
  ['Noto Serif JP DemiLight', 'https://github.com/googlefonts/noto-cjk/raw/main/Serif/OTF/Japanese/NotoSerifCJKjp-DemiLight.otf'],
  ['Noto Serif JP Regular', 'https://github.com/googlefonts/noto-cjk/raw/main/Serif/OTF/Japanese/NotoSerifCJKjp-Regular.otf'],
  ['Noto Serif JP Medium', 'https://github.com/googlefonts/noto-cjk/raw/main/Serif/OTF/Japanese/NotoSerifCJKjp-Medium.otf'],
  ['Noto Serif JP Bold', 'https://github.com/googlefonts/noto-cjk/raw/main/Serif/OTF/Japanese/NotoSerifCJKjp-Bold.otf'],
  ['Noto Serif JP Black', 'https://github.com/googlefonts/noto-cjk/raw/main/Serif/OTF/Japanese/NotoSerifCJKjp-Black.otf'],
  ['Noto Sans JP Thin', 'https://github.com/googlefonts/noto-cjk/raw/main/Sans/OTF/Japanese/NotoSansCJKjp-Thin.otf'],
  ['Noto Sans JP Light', 'https://github.com/googlefonts/noto-cjk/raw/main/Sans/OTF/Japanese/NotoSansCJKjp-Light.otf'],
  ['Noto Sans JP DemiLight', 'https://github.com/googlefonts/noto-cjk/raw/main/Sans/OTF/Japanese/NotoSansCJKjp-DemiLight.otf'],
  ['Noto Sans JP Regular', 'https://github.com/googlefonts/noto-cjk/raw/main/Sans/OTF/Japanese/NotoSansCJKjp-Regular.otf'],
  ['Noto Sans JP Medium', 'https://github.com/googlefonts/noto-cjk/raw/main/Sans/OTF/Japanese/NotoSansCJKjp-Medium.otf'],
  ['Noto Sans JP Bold', 'https://github.com/googlefonts/noto-cjk/raw/main/Sans/OTF/Japanese/NotoSansCJKjp-Bold.otf'],
  ['Noto Sans JP Black', 'https://github.com/googlefonts/noto-cjk/raw/main/Sans/OTF/Japanese/NotoSansCJKjp-Black.otf'],
]);

const loadFont = async (fontName: string): Promise<opentype.Font | null> => {
	const url = fontURLs.get(fontName);
	if (url == null) {
		return null;
	}
	const fileName = _.last(url.split('/'));
	const fontPath = path.resolve(__dirname, fileName);

	const fontExists = await new Promise((resolve) => {
		fs.access(fontPath, fs.constants.F_OK, (error) => {
			resolve(!error);
		});
	});

	if (!fontExists) {
		await download(url, __dirname, {
			filename: fileName,
		});
	}

	const font: opentype.Font = await new Promise((resolve, reject) => {
		opentype.load(fontPath, (error: any, f?: opentype.Font) => {
			if (error) {
				reject(error);
			} else {
				resolve(f);
			}
		});
	});

	return font;
};

export default loadFont;
