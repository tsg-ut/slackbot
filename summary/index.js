require('dotenv').config();

const {countBy, groupBy, maxBy, minBy} = require('lodash');
const {google} = require('googleapis');
const moment = require('moment');
const JSZip = require('jszip');
const fs = require('fs');
const concatStream = require('concat-stream');
const schedule = require('node-schedule');
const {stripIndent} = require('common-tags');

const logger = require('../lib/logger.js');
const {makeSummary} = require('./summary_writer.js');


async function getZipData(drive, month) {
    const filename = `sandbox-messages-${month}.zip`;
    if (drive) {
        const {data: {files}} = await drive.files.list({
            pageSize: 100,
            fields: 'nextPageToken, files(id, name)',
            q: `name = '${filename}'`,
        });
        if (!files || files.length !== 1) return null;
    
        const file = files[0];
        console.log(`downloading file ${file.id}...`);
        const stream = await drive.files.get({
            fileId: file.id,
            alt: 'media',
        }, {
            responseType: 'stream',
        }).then(res => res.data);
        const bufferPromise = new Promise((resolve, reject) => {
            const cat = concatStream(data => {resolve(data);});
            stream.pipe(cat);
        });
        const zipbuf = await JSZip.loadAsync(bufferPromise);
        return zipbuf;
    }
    
    // local
    const bufferPromise = new Promise((resolve, reject) => {
        fs.readFile(__dirname + '/' + filename, (err, data) => {
            if (err) logger.info(`unable to load ${filename}`);
            else {logger.info(`successfully loaded ${filename}`); resolve(data);}});
    });
    const zipbuf = await JSZip.loadAsync(bufferPromise);
    return zipbuf;
}

async function getRecords() {
    let drive = null;
    if (process.env.NODE_ENV === 'production') {
        const TOKEN = 'token.json';
        const auth = await new Promise((resolve, reject) => {
            fs.readFile(process.env.GOOGLE_APPLICATION_CREDENTIALS, (err, content) => {
                if (err) {
                    logger.error(err);
                    reject(err);
                    return;
                }
                const credentials = JSON.parse(content);
                const {client_secret, client_id, redirect_uris} = credentials.installed;
                const newAuth = new google.auth.OAuth2(
                    client_id,
                    client_secret,
                    redirect_uris[0]
                );
                fs.readFile(TOKEN, (err, token) => {
                    if (err) {
                        logger.error(err);
                        reject(err);
                        return;
                    }
                    newAuth.setCredentials(JSON.parse(token));
                    resolve(newAuth);
                });
            });
        });
        drive = google.drive({version: 'v3', auth});
    }

    const now = moment().startOf('day').hours(6).utcOffset(9);
    const dayago = moment().startOf('day').hours(6).utcOffset(9).subtract(1, 'days');
    const nowMonth = now.format('YYYYMM');
    const dayagoMonth = dayago.format('YYYYMM');
    const nowZip = await getZipData(drive, nowMonth);
    const dayagoZip = (nowMonth === dayagoMonth) ? nowZip : await getZipData(drive, dayagoMonth);

    const messages = [];
    for (const [mom, zip] of [[dayago, dayagoZip], [now, nowZip]]) {
        if (!zip) continue;
        const date = mom.format('YYYY-MM-DD');
        const jsonData = zip.file(`sandbox/${date}.json`);
        if (!jsonData) continue;
        const records = await jsonData.async('string')
            .then(JSON.parse)
            .then(data => data.filter(mes => {
                const time = moment(mes.ts*1000).utcOffset(9);
                return (
                    //!mes.thread_ts &&
                    time.isBefore(now) && time.isAfter(dayago)
                );
            }));
        messages.push(...records);
    }

    return messages;
}

async function job(slack) {
    const rawMessages = await getRecords();
    const summary = await makeSummary(rawMessages, slack);
    await slack.chat.postMessage({
        channel: process.env.CHANNEL_SANDBOX,
        username: 'summary',
        text: ":sandbox: 昨日のサンドボックス :sandbox:\n",
        attachments: summary,
    });
}

module.exports = async ({rtmClient: rtm, webClient: slack}) => {
    if (process.env.NODE_ENV === 'production') {
        schedule.scheduleJob('0 7 * * *', async () => {job(slack);});
    } else {
        job(slack);
    }
}
