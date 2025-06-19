import {Mutex} from 'async-mutex';
import fs from 'fs';
import path from 'path';
import JSZip from 'jszip';
import {sample,sampleSize,uniq} from 'lodash';
import type {SlackInterface} from '../lib/slack';
import {download} from '../lib/download';
import {parse as csv_parse} from 'csv-parse';
import {AteQuiz,AteQuizProblem} from '../atequiz';
import type { ChatPostMessageArguments } from '@slack/web-api';
import { stripIndent } from 'common-tags';
import {Loader} from '../lib/utils';

/*
Future works
- n文字熟語 / n 段
*/
const mutex = new Mutex();

const kanjisLoader : Loader<string[]> = new Loader(async () => {
  const text = await fs.promises.readFile(path.join(__dirname, 'data','JoyoKanjis.txt'));
  return text.toString('utf-8').split('\n');
});
/*
jukugo[i].get(c)は『i文字目がcのときの残りの文字としてありうるもの』
*/
type jukugoDict = [
  Map<string,string[]>,
  Map<string,string[]>
];

const jukugoLoader : Loader<jukugoDict> = new Loader(async () => {
  const kanjis = await kanjisLoader.load();
  const kanjisSet = new Set(kanjis);
  const dictionaryPath = path.resolve(__dirname, 'data','2KanjiWords.txt');
  const dictionaryExists = await new Promise((resolve) => {
    fs.access(dictionaryPath, fs.constants.F_OK, (error) => {
      resolve(!error);
    });
  });
  if(!dictionaryExists){
    const corpusPath = path.resolve(__dirname, 'data','corpus.zip');
    await download(corpusPath,"https://repository.ninjal.ac.jp/?action=repository_uri&item_id=3231&file_id=22&file_no=1");
    const data = await fs.promises.readFile(corpusPath);
    const dict : string = await new Promise((resolve,reject) => {
      JSZip.loadAsync(data as any).then((zip) => {
        return zip.files["BCCWJ_frequencylist_luw2_ver1_1.tsv"].nodeStream('nodebuffer');
      }).then((text) => {
        const parser = csv_parse({
          delimiter: '\t',
          quote: null,
          skip_records_with_error: true,
        });
        const res : string[] = [];
        parser.on('data', (data:string[]) => {
          const word = data[2];
          if(word.length !== 2)return;
          if(word.split('').some((c => !kanjisSet.has(c))))return;
          const type_ = data[3];
          if(type_.includes("人名"))return;
          const freq = Number(data[6]);
          if(freq < 30)return;
          res.push(word);
        });
        parser.on('error', () => {
          reject('parse failed');
        });
        parser.on('end', () => {
          resolve(uniq(res).join('\n'));
        });
    		text.pipe(parser as any);
      })
    });
    await fs.promises.writeFile(dictionaryPath,dict);
  }

  const js : string[] =
    (await fs.promises.readFile(dictionaryPath)).toString('utf-8').split('\n');
  const res : jukugoDict = [new Map<string,string[]>(),new Map<string,string[]>()];
  for(const c of kanjis){
    res.forEach((m) => m.set(c,[]));
  }
  for(const j of js){
    const cs = j.split('');
    if(cs.some((c) => !kanjisSet.has(c))){
      break;
    }
    res[0].get(cs[0]).push(cs[1]);
    res[1].get(cs[1]).push(cs[0]);
  }
  return res;
});

type WadoProblem = [string[],string[]];
interface Problem{
  problem: WadoProblem,
  repr: string,
  answers: string[],
  acceptAnswerMap: Map<string,string>,
}

async function SolveProblem(jukugo: jukugoDict, problem: Problem) : Promise<string[]> {
  const kanjis = await kanjisLoader.load();
  const dics = problem.problem.map((v,i) =>
    v.map((c) => jukugo[i].get(c))
  );
  return kanjis.filter((c) => {
    if(dics[0].some(cs => !cs.includes(c)))return false;
    if(dics[1].some(cs => !cs.includes(c)))return false;
    return true;
  });
}

async function generateProblem(jukugo:jukugoDict) : Promise<Problem> {
  const kanjis = await kanjisLoader.load();
  let lcnt = 0;
  let problem : WadoProblem = null;
  while(true){
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

  // フォントがどうしてもずれる
  const repr = stripIndent`
    :_::_::_: ${problem[0][0]}
    :_::_::_::arrow_down:
    :_: ${problem[0][1]} :arrow_right::question::arrow_right: ${problem[1][0]}
    :_::_::_::arrow_down:
    :_::_::_: ${problem[1][1]}
  `;

  const answers = await SolveProblem(jukugo, { problem, repr: "",answers: [], acceptAnswerMap: new Map()});
  const acceptAnswerMap : Map<string,string> = new Map();
  for(const c of answers){
    acceptAnswerMap.set(c,c);
    for(const d of problem[0]){
      acceptAnswerMap.set(d + c,c);
    }
    for(const d of problem[1]){
      acceptAnswerMap.set(c + d,c);
    }
  }
  return {
    problem,
    repr,
    answers,
    acceptAnswerMap,
  }
}

class WadoQuiz extends AteQuiz {
  data: Problem;
  channel: string;
  constructor(
    clients: SlackInterface,
    problem: AteQuizProblem,
    data: Problem,
    channel: string,
    option?: Partial<ChatPostMessageArguments>,
  ){
    super(clients, problem, option);
    this.data = data;
    this.channel = channel;
  }
  waitSecGen() {
    return 180;
  }
  solvedMessageGen(post: any){
    const user : string = post.user;
    const answer : string = post.text;
    const answerChar = this.data.acceptAnswerMap.get(answer);
    return ({
      channel: this.channel,
      text: (`<@${user}> 『${answerChar}』正解🎉` + (
        this.data.answers.length === 1 ? "" : `\n他にも『${
          this.data.answers.filter((c) => c !== answerChar).join('/')}』などが当てはまります。`
      )),
    })
  }
}

export default (slackClients: SlackInterface) => {
  const {eventClient,webClient} = slackClients;

  const channel = process.env.CHANNEL_SANDBOX;
  eventClient.on('message', (message) => {
    if (message.channel !== channel) {
      return;
    }
    if (message.text && (
          message.text === '和同開珎' ||
          message.text === '和同' ||
          message.text === '開珎' ||
          message.text === 'わどう')) {
      if(mutex.isLocked()) {
        webClient.reactions.add({
          name: "running",
          channel: message.channel,
          timestamp: message.ts,
        });
        return;
      }
      mutex.runExclusive(async () => {
        const data = await generateProblem(await jukugoLoader.load());
        const problem : AteQuizProblem = {
          problemMessage: {
            channel,
            text: `${data.repr}`,
          },
          hintMessages: [],
          immediateMessage: {
            channel,
            text: ':question:に入る常用漢字は何でしょう？3分以内に答えてね。'
          },
          solvedMessage: null,
          unsolvedMessage: {
            channel,
            text: `時間切れ！\n正解は『${data.answers.join('/')}』でした。`,
          },
          answerMessage: null,
          correctAnswers: [...data.acceptAnswerMap.keys()]
        };
        const quiz = new WadoQuiz(
          slackClients,
          problem,
          data,
          channel,
          {username: '和同開珎', icon_emoji: ':coin:'},
        );
        const result = await quiz.start();
        if (result.state === 'solved') {
          // TODO: add achievenemts
        }
      });
    }
  });
};
