import {Mutex} from 'async-mutex';
import fs from 'fs';
import path from 'path';
import JSZip from 'jszip';
import {sample,sampleSize} from 'lodash';
import type {SlackInterface} from '../lib/slack';
import {download} from '../lib/download';
import csv_parse from 'csv-parse';

/*
Future works
- n文字熟語 / n 段
- 入力にできる単語も受け付ける
*/
const mutex = new Mutex();

const kanjis : string[] =
  fs.readFileSync(path.join(__dirname, 'data','JoyoKanjis.txt'),{encoding: 'utf8'}).split('\n');

/*
jukugo[i].get(c)は『i文字目がcのときの残りの文字としてありうるもの』
*/
type jukugoDict = [
  Map<string,string[]>,
  Map<string,string[]>
];

async function getDictionary() : Promise<jukugoDict>{
  const dictionaryPath = path.resolve(__dirname, 'data','2KanjiWords.txt');
  const dictionaryExists = await new Promise((resolve) => {
		fs.access(dictionaryPath, fs.constants.F_OK, (error) => {
			resolve(!error);
		});
	});
  if(!dictionaryExists){
    const corpusPath = path.resolve(__dirname, 'data','corpus.zip');
    await download(corpusPath,"https://repository.ninjal.ac.jp/?action=repository_uri&item_id=3231&file_id=22&file_no=1");
    await new Promise((resolve,error) => {
      fs.readFile(corpusPath, function(err, data) {
        if (err) throw err;
        JSZip.loadAsync(data).then((zip) => {
          return zip.files["BCCWJ_frequencylist_luw2_ver1_1.tsv"].nodeStream('nodebuffer');
        }).then((text) => {
          const parser = csv_parse({
            delimiter: '\t',
            quote: null,
            skip_lines_with_error: true,
          });
          const res : string[] = [];
          parser.on('readable', () => {
            for(;;){
              const v : string[] = parser.read();
              if(v === null)break;
              const word = v[2];
              if(word.length !== 2)continue;
              if(word.split('').some((c => !kanjis.includes(c))))continue;
              const type_ = v[3];
              if(type_.includes("人名"))continue;
              const freq = Number(v[6]);
              if(freq < 30)continue;
              res.push(word);
            }
          });
          parser.on('error', () => {
            error('parse failed');
          });
          parser.on('end', () => {
            fs.writeFileSync(dictionaryPath,res.join('\n'));
            resolve('finished');
          });
          text.pipe(parser);
        })
      });
    });
    return await getDictionary();
  }

  const js = fs.readFileSync(dictionaryPath,{encoding: 'utf8'}).split('\n');
  const res : jukugoDict = [new Map<string,string[]>(),new Map<string,string[]>()];
  for(const c of kanjis){
    res.forEach((m) => m.set(c,[]));
  }
  for(const j of js){
    const cs = j.split('');
    if(cs.some((c) => !kanjis.includes(c))){
      break;
    }
    res[0].get(cs[0]).push(cs[1]);
    res[1].get(cs[1]).push(cs[0]);
  }
  return res;
}

type WadoProblem = [string[],string[]];
interface Problem{
  problem: WadoProblem,
  repr: string,
  answers: string[]
}

function SolveProblem(jukugo: jukugoDict, problem: Problem) : string[] {
  const dics = problem.problem.map((v,i) => {
    return v.map((c) => jukugo[i].get(c));
  });
  return kanjis.filter((c) => {
    if(dics[0].some(cs => !cs.includes(c)))return false;
    if(dics[1].some(cs => !cs.includes(c)))return false;
    return true;
  });
}

async function generateProblem(jukugo:jukugoDict){
  let lcnt = 0;
  let problem : WadoProblem = null;
  for(;;){
    const c = sample(kanjis);
    const j0 = jukugo[0].get(c);
    const j1 = jukugo[1].get(c);
    if(j0.length >= 2 && j1.length >= 2){
      problem = [
        sampleSize(j1,2),
        sampleSize(j0,2),
      ];
      break;
    }
    lcnt += 1;
    if(lcnt > 100)break;
  }
  // console.log('cnt',lcnt);

  // フォントがどうしてもずれる
  const repr = `
:_::_: ${problem[0][0]}
:_::_::arrow_down:
 ${problem[0][1]} :arrow_right::question::arrow_right: ${problem[1][0]}
:_::_::arrow_down:
:_::_: ${problem[1][1]}
  `;

//   const repr = `
//  ${problem[0][0]} :arrow_right::question::arrow_right: ${problem[1][0]}
//  ${problem[0][1]} :arrow_right::question::arrow_right: ${problem[1][1]}
//   `;
  const answers = SolveProblem(jukugo, { problem, repr: "",answers: [] });
  return {
    problem,
    repr,
    answers
  }
}

const botUsername = '和同開珎';
const botIcon = ':coin';

export default ({eventClient, webClient: slack}: SlackInterface) => {
	const state: {
    problem: Problem,
    thread: string
  } = {
		problem: null,
		thread: null,
	};

  const jukugo = getDictionary();

  function timeLimit(thread:string){
    return (async () => {
      mutex.runExclusive(async () => {
        if(state.problem !== null && state.thread === thread){
          slack.chat.postMessage({
            channel: process.env.CHANNEL_SANDBOX,
            text: `時間切れ！\n正解は『${state.problem.answers.join('/')}』でした。`,
            username: botUsername,
            icon_emoji: botIcon,
            thread_ts: state.thread,
            reply_broadcast: true,
          });

          state.problem = null;
          state.thread = null;
        }
      });
    });
  }

	eventClient.on('message', (message) => {
		if (message.channel !== process.env.CHANNEL_SANDBOX) {
			return;
		}
    mutex.runExclusive(async () => {
      if (message.text && message.text === '和同開珎' && state.problem === null) {
        const problem = await generateProblem(await jukugo);
        const {ts} = await slack.chat.postMessage({
          channel: process.env.CHANNEL_SANDBOX,
          text: `${problem.repr}`,
          username: botUsername,
          icon_emoji: botIcon,
        });
				state.thread = ts as string;
        state.problem = problem;

        slack.chat.postMessage({
          channel: process.env.CHANNEL_SANDBOX,
          text: ':question:に共通して入る常用漢字は何でしょう？3分以内に答えてね。',
          username: botUsername,
          icon_emoji: botIcon,
          thread_ts: ts as string,
        });

        setTimeout(timeLimit(state.thread), 3 * 60 * 1000);
      }
      else if (state.problem !== null && message.text && !message.text.match(/^[?？]/) && message.thread_ts === state.thread && message.username !== botUsername) {
        if (state.problem.answers.includes(message.text)) {
          const text = `<@${message.user}> 『${message.text}』正解🎉` + (
            state.problem.answers.length === 1 ? "" : `\n他にも${
              state.problem.answers.filter((c) => c !== message.text).join('/')}などが当てはまります。`
          );
					await slack.chat.postMessage({
						channel: process.env.CHANNEL_SANDBOX,
						text: text,
						username: botUsername,
						icon_emoji: botIcon,
						thread_ts: state.thread,
						reply_broadcast: true,
					});

					state.problem = null;
					state.thread = null;
				} else {
					slack.reactions.add({
						name: 'no_good',
						channel: message.channel,
						timestamp: message.ts,
					});
				}
      }
    });
  });
};
