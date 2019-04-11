// @ts-ignore
import * as opentype from 'opentype.js';
// @ts-ignore
import download from 'download';
import path from 'path';
import fs from 'fs';

const loadFont = async () => {
	const fontPath = path.resolve(__dirname, 'NotoSerifCJKjp-Bold.otf');

	const fontExists = await new Promise((resolve) => {
		fs.access(fontPath, fs.constants.F_OK, (error) => {
			resolve(!error);
		});
	});

	if (!fontExists) {
		await download('https://github.com/googlei18n/noto-cjk/raw/master/NotoSerifCJKjp-Bold.otf', __dirname, {
			filename: 'NotoSerifCJKjp-Bold.otf',
		});
	}

	const font: any = await new Promise((resolve, reject) => {
		opentype.load(fontPath, (error: any, f: any) => {
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
