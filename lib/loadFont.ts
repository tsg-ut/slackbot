// @ts-ignore
import * as opentype from 'opentype.js';
// @ts-ignore
import download from 'download';
import path from 'path';
import fs from 'fs';
import * as _ from 'lodash';

const loadFont = async (url: string = 'https://github.com/googlei18n/noto-cjk/raw/master/NotoSerifCJKjp-Bold.otf', localName?: string) => {
	const fontName = localName == null ? _.last(url.split('/')) : localName;
	const fontPath = path.resolve(__dirname, fontName);

	const fontExists = await new Promise((resolve) => {
		fs.access(fontPath, fs.constants.F_OK, (error) => {
			resolve(!error);
		});
	});

	if (!fontExists) {
		await download(url, __dirname, {
			filename: fontName,
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
