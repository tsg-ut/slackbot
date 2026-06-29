import fs from 'node:fs';
import {mkdir} from 'node:fs/promises';
import path from 'node:path';
import axios from 'axios';
import type {Stream} from 'stream';

export const download = async (filePath: string, url: string): Promise<undefined> => {
    const dataExists = await new Promise((resolve) => {
        fs.access(filePath, fs.constants.F_OK, (error) => {
            resolve(!error);
        });
    });
    if (dataExists) return undefined;
    await mkdir(path.dirname(filePath), {recursive: true});
    const response = await axios.get<Stream>(url, {responseType: 'stream'});
    return new Promise<undefined>((resolve, reject) => {
        response.data.pipe(fs.createWriteStream(filePath))
            .on('finish', () => {
                resolve(undefined);
            })
            .on('error', reject);
    });
};
