import fs from 'fs';
import axios from 'axios';

export const download = async (path: string, url: string): undefined | Promise<undefined> => {
    const dataExists = await new Promise((resolve) => {
        fs.access(path, fs.constants.F_OK, (error) => {
            resolve(!error);
        });
    });
    return dataExists ? undefined : new Promise(async (resolve, reject) => {
        const response = await axios.get(url, {responseType: 'stream'});
        response.data.pipe(fs.createWriteStream(path))
            .on('finish', () => {
                resolve(undefined);
            })
            .on('error', reject);
    });
};