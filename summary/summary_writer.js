require('dotenv').config();

const {uniq, countBy, groupBy, maxBy, minBy} = require('lodash');
const moment = require('moment');
const {tokenize} = require('kuromojin');
const cloud = require('d3-cloud');
const {JSDOM} = require('jsdom');
const d3 = require('d3');
const cloudinary = require('cloudinary');
const {createCanvas, Image, registerFont} = require('canvas');
const path = require('path');

const logger = require('../lib/logger.ts');

let fontloaded = false;

function filtering(messages) {
    let out = messages.filter((mes) => mes.user && mes.text);
    // URL, channel ID, user ID
    out = out.map((mes) => {
        mes.text = mes.text.replace(/<.+?>/g, '');
        return mes;
    });
    // emoji
    out = out.map((mes) => {
        mes.text = mes.text.replace(/:.+:/g, '');
        return mes;
    });

    out = out.filter((mes) => mes.text.length > 0);
    return out;
}

module.exports.makeSummary = async (messages, slack) => {
    if (!fontloaded) {
        const fontPath = path.resolve(
            __dirname, '../lib/NotoSerifCJKjp-Bold.otf');
        registerFont(fontPath, {family: 'NotoSerifCJKjp'});
        fontloaded = true;
    }
    const {members} = await slack.users.list();
    const getMemberName = (user) => {
        const member = members.find(({id}) => id === user);
        if (!member) return 'undefined';
        return member.profile.display_name || member.name;
    };
    const summary = [];

    // 瞬間最高コメント速度 (分刻み)
    {
        const minMessages = groupBy(messages, (mes) => {
            return moment(mes.ts*1000).utcOffset(9).format('HH:mm');
        });
        const [strongestTime, strongestRecord] = maxBy(
            Object.entries(minMessages),
            ([, records]) => records.filter((rec) => rec.user).length
        );
        summary.push({
            title: `瞬間最高風速 ${strongestRecord.length} posts/min (${strongestTime})`,
            title_link: `https://slack-log.tsg.ne.jp/${process.env.CHANNEL_SANDBOX}/${strongestRecord[0].ts}`,
            text: strongestRecord.slice(0, 5).map(
                (rec) => `${getMemberName(rec.user)}: ${rec.text}`
            ).join('\n'),
        });
    }

    // コメント速度推移
    {
        const halfHourMessages = Object.entries(countBy(messages, (mes) => {
            const time = moment(mes.ts*1000).utcOffset(9);
            const minutes = Math.floor(time.minutes() / 30) * 30;
            return time.startOf('hour').minutes(minutes).unix();
        }));
        halfHourMessages.sort();
        const xaxis = '0:|' + halfHourMessages.map(([time]) => {
            const mom = moment.unix(time);
            if (mom.minutes() == 0 && mom.hour() % 2 == 0) {
                return mom.format('HH:mm');
            } else {
                return '';
            }
        }).join('|');
        const maxlen = halfHourMessages.reduce(
            (acc, x) => Math.max(acc, x[1]), 0);
        const data = 't:' + halfHourMessages.map(
            ([, len]) => (100*len/maxlen).toFixed(2)).join(',');
        const chartLink = `http://chart.apis.google.com/chart?chs=600x250&chd=${data}&cht=lc&chxt=x,y&chxr=1,0,${maxlen}&chxl=${xaxis}`;
        logger.info('chartLink:' + chartLink);
        summary.push({
            title: '30分ごとのメッセージ量',
            image_url: chartLink,
        });
    }

    // wordcloud
    {
        const TARGET_POS = ['名詞', '動詞', '形容詞'];
        const CANVAS_W = 1000;
        const CANVAS_H = 1000;
        const MAXFONT = 150;
        const MINFONT = 10;
        const WORDS_LIMIT = 600;
        const PNG_W = 300;
        const PNG_H = 300;
        const hiraganaLetters = 'ぁあぃいぅうぇえぉおかがきぎくぐけげこごさざしじすずせぜそぞただちぢっつづてでとどなにぬねのはばぱひびぴふぶぷへべぺほぼぽまみむめもゃやゅゆょよらりるれろわをんー'.split('');
        const stopWords = ['てる', 'いる', 'なる', 'れる', 'する', 'ある', 'こと', 'これ', 'さん', 'して',
            'くれる', 'やる', 'くださる', 'そう', 'せる', 'した', '思う',
            'それ', 'ここ', 'ちゃん', 'くん', 'ない', 'ので', 'よう',
            ',', '.', '、', '。', '(', ')', '（', '）'].concat(hiraganaLetters);
        const wordsPromise = filtering(messages).map(async (mes) => await (
            tokenize(mes.text)
                .then((res) => res.reduce((acc, e) => {
                    if (e.pos === '名詞' &&
                            acc.length > 0 &&
                            acc[acc.length-1].pos === '名詞' &&
                            !stopWords.includes(e.surface_form) &&
                            !stopWords.includes(acc[acc.length-1].surface_form)) {
                        const newword = acc[acc.length-1].surface_form + e.surface_form;
                        acc[acc.length-1].surface_form = newword;
                        return acc;
                    } else {
                        return acc.concat(e);
                    }
                }, []))
                .then((res) => res.filter((r) => TARGET_POS.includes(r.pos)))
                .then((res) => res.map((r) => r.surface_form))
                .then(uniq)
        ));
        const wordsCount = await Promise.all(wordsPromise)
            .then((x) => [].concat(...x))
            .then(countBy)
            .then(Object.entries)
            .then((xs) => xs.filter(([text]) => !stopWords.includes(text)))
            .then((xs) => xs.filter(([, count]) => count > 1))
            .then((xs) => {
                xs.sort((a, b) => (b[1] - a[1]));
                return xs.slice(0, WORDS_LIMIT);
            })
            // .then(xs => {logger.info(xs.toString()); return xs;})
            .then((xs) => xs.map(([text, size]) => {
                return {text, size};
            }));

        const {size: maxwordsize} = maxBy(wordsCount, 'size');
        const {size: minwordsize} = minBy(wordsCount, 'size');
        const cloudSVG = await new Promise((resolve) => {
            cloud().size([CANVAS_W, CANVAS_H])
                .canvas(() => createCanvas(CANVAS_W, CANVAS_H))
                .words(wordsCount)
                .rotate(() => 0)
                .fontWeight((word) => Math.pow(word.size, 1.3) * 1.0)
                .fontSize((word) =>
                    MINFONT +(MAXFONT-MINFONT) * Math.log(1 + (word.size-minwordsize)/(maxwordsize-minwordsize) * (Math.pow(Math.E, 2)-1) / 2)
                )
                .font('NotoSerifCJKjp')
                .padding(0.2)
                .on('end', resolve)
                .start();
        }).then((data) => {
            const document = new JSDOM('<body></body>').window.document;
            d3.select(document.body)
                .append('svg')
                .attr('xmlns', 'http://www.w3.org/2000/svg')
                .attr('class', 'ui fluid image')
                .attr('viewbox', `0 0 ${CANVAS_W} ${CANVAS_H}`)
                .attr('width', `${CANVAS_W}px`)
                .attr('height', `${CANVAS_H}px`)
                .append('g')
                .attr('transform', `translate(${CANVAS_W/2}, ${CANVAS_H/2})`)
                .selectAll('text')
                .data(data)
                .enter().append('text')
                .style('font-size', (d) => `${d.size}px`)
                .style('font-family', (d) => d.font)
                .attr('transform', (d) => `translate(${d.x}, ${d.y}) rotate(${d.rotate})`)
                .style('fill', (d, i) => d3.schemeCategory10[i % 10])
                .attr('text-anchor', 'middle')
                .text((d) => d ? d.text : '');
            return document.body.innerHTML;
        });
        const canvas = createCanvas(PNG_W, PNG_H);
        const ctx = canvas.getContext('2d');
        const canPromise = new Promise((resolve, reject) => {
            logger.info('converting');
            const image = new Image;
            image.onload = () => {
                ctx.drawImage(image, 0, 0, image.width, image.height, 0, 0, PNG_W, PNG_H);
                canvas.toBuffer((err, buf) => {
                    if (err) {
                        logger.error('error toBuffer'); reject(err);
                    } else resolve(buf);
                });
            };
            image.src = `data:image/svg;base64,${Buffer.from(cloudSVG).toString('base64')}`;
        });
        const cloudPNG = await canPromise;

        const cloudinaryData = await new Promise((resolve, reject) => {
            logger.info('uploading');
            cloudinary.v2.uploader
                .upload_stream({resource_type: 'image'}, (error, response) => {
                    if (error) {
                        logger.error(error);
                        reject(error);
                    } else {
                        logger.info('uploaded!');
                        resolve(response);
                    }
                })
                .end(cloudPNG);
        });
        summary.push({
            title: 'WORD CLOUD',
            image_url: cloudinaryData.secure_url,
        });
    }


    return summary;
};
