import fs from 'fs';
import {mkdir} from 'fs/promises';
import path from 'path';
import axios from 'axios';
import type {Stream} from 'stream';

export const download = async (filePath: string, url: string): undefined | Promise<undefined> => {
    const dataExists = await new Promise((resolve) => {
        fs.access(filePath, fs.constants.F_OK, (error) => {
            resolve(!error);
        });
    });
    if (dataExists) return undefined;
    await mkdir(path.dirname(filePath), {recursive: true});
    return new Promise(async (resolve, reject) => {
        const response = await axios.get<Stream>(url, {responseType: 'stream'});
        response.data.pipe(fs.createWriteStream(filePath))
            .on('finish', () => {
                resolve(undefined);
            })
            .on('error', reject);
    });
};
