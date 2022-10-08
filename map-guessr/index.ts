// eslint-disable-next-line import/no-namespace
import * as Turf from "@turf/turf";
import fs from "fs-extra";
import type { SlackInterface } from "../lib/slack";
import puppeteer from "puppeteer";
import { AteQuizResult } from "../atequiz";
import {
  ChatPostMessageArguments,
  ChatPostMessageResponse,
  WebAPICallOptions,
  WebClient,
} from "@slack/web-api";
import assert from "assert";
import { increment } from "../achievements";
import { Deferred } from "../lib/utils";
import { TeamEventClient } from "../lib/slackEventClient";
const { Mutex } = require("async-mutex");
const { AteQuiz } = require("../atequiz/index.ts");
const cloudinary = require("cloudinary");

const API_KEY = process.env.GOOGLE_MAPS_API_KEY;
const CHANNEL = process.env.CHANNEL_SANDBOX;
const mutex = new Mutex();

const img_size = 1000;

interface CoordAteQuizProblem {
  problemMessage: ChatPostMessageArguments;
  hintMessages: ChatPostMessageArguments[];
  immediateMessage: ChatPostMessageArguments | null;
  solvedMessage: ChatPostMessageArguments;
  incorrectMessage: ChatPostMessageArguments;
  unsolvedMessage: ChatPostMessageArguments;
  answerMessage?: ChatPostMessageArguments | null;
  correctAnswers: string[];
}

class CoordAteQuiz extends AteQuiz {
  constructor(
    eventClient: TeamEventClient,
    slack: WebClient,
    problem: CoordAteQuizProblem,
    loading: ChatPostMessageResponse,
    option?: WebAPICallOptions
  ) {
    super({ eventClient, webClient: slack }, problem, option);
    this.answeredUsers = new Set();
    this.loading = loading;
  }

  judge(answer: string, _user: string) {
    if (latLngDeformat(answer) === null) {
      return false;
    } else {
      const [lat, lng] = latLngDeformat(answer);
      const [latans, lngans] = latLngDeformat(this.problem.correctAnswers[0]);
      const [xm, ym] = latLngToMercator(lat, lng);
      const [xmans, ymans] = latLngToMercator(latans, lngans);
      const zoom = parseFloat(this.problem.correctAnswers[1]);
      const dist = ((Math.PI / 128) * img_size) / 2 / 2 ** zoom;
      if (
        Math.cos(xm - xmans) >= Math.cos(dist) &&
        Math.abs(ym - ymans) <= dist
      ) {
        return true;
      } else {
        return false;
      }
    }
  }

  incorrectMessageText(userAnswer: string) {
    if (latLngDeformat(userAnswer) === null) {
      return `<@[[!user]]> 解答形式が間違っているよ:cry:`;
    } else {
      const [lat, lng] = latLngDeformat(userAnswer);
      const [latans, lngans] = latLngDeformat(this.problem.correctAnswers[0]);
      const [x, y, z] = polarToCartesian(
        (lat / 180) * Math.PI,
        (lng / 180) * Math.PI
      );
      const [xans, yans, zans] = polarToCartesian(
        (latans / 180) * Math.PI,
        (lngans / 180) * Math.PI
      );
      const distance = Math.acos(x * xans + y * yans + z * zans) * 6378.137;
      return `<@[[!user]]> 不正解:x:\n中心点までの距離は${distFormat(
        distance
      )}だよ:cry:`;
    }
  }
  solvedMessageText(userAnswer: string) {
    const [lat, lng] = latLngDeformat(userAnswer);
    const [latans, lngans] = latLngDeformat(this.problem.correctAnswers[0]);
    const [x, y, z] = polarToCartesian(
      (lat / 180) * Math.PI,
      (lng / 180) * Math.PI
    );
    const [xans, yans, zans] = polarToCartesian(
      (latans / 180) * Math.PI,
      (lngans / 180) * Math.PI
    );
    const distance = Math.acos(x * xans + y * yans + z * zans) * 6378.137;
    return `<@[[!user]]> 正解:tada:\n中心点の座標は ${
      this.problem.correctAnswers[0]
    } 、中心点までの距離は${distFormat(
      distance
    )}だよ:muscle:\nhttps://maps.google.co.jp/maps?ll=${latans},${lngans}&q=${latans},${lngans}&t=k
			`;
  }

  incorrectMessageGen(post: any): ChatPostMessageArguments {
    const message = Object.assign({}, this.problem.incorrectMessage);
    message.text = message.text.replaceAll(
      this.replaceKeys.correctAnswerer,
      post.user as string
    );
    return message;
  }

  waitSecGen(hintIndex: number): number {
    return hintIndex === this.problem.hintMessages.length ? 180 : 120;
  }

  async start(): Promise<AteQuizResult> {
    this.state = "solving";

    const postMessage = (message: ChatPostMessageArguments) => {
      const toSend = Object.assign({}, message, this.postOption);
      return this.slack.chat.postMessage(toSend);
    };

    const result: AteQuizResult = {
      quiz: this.problem,
      state: "unsolved",
      correctAnswerer: null,
      hintIndex: null,
    };

    let previousHintTime: number = null;
    let hintIndex = 0;

    const deferred = new Deferred<AteQuizResult>();

    const onTick = () => {
      this.mutex.runExclusive(async () => {
        const now = Date.now();
        const nextHintTime =
          previousHintTime + 1000 * this.waitSecGen(hintIndex);
        if (this.state === "solving" && nextHintTime <= now) {
          previousHintTime = now;
          if (hintIndex < this.problem.hintMessages.length) {
            const hint = this.problem.hintMessages[hintIndex];
            await postMessage(Object.assign({}, hint, { thread_ts }));
            hintIndex++;
          } else {
            this.state = "unsolved";
            await postMessage(
              Object.assign({}, this.problem.unsolvedMessage, { thread_ts })
            );

            if (this.problem.answerMessage) {
              await postMessage(
                Object.assign({}, this.problem.answerMessage, { thread_ts })
              );
            }
            clearInterval(tickTimer);
            deferred.resolve(result);
          }
        }
      });
    };

    this.eventClient.on("message", async (message: any) => {
      if (message.thread_ts === thread_ts) {
        if (
          message.subtype === "bot_message" ||
          message.subtype === "file_share"
        )
          return;
        this.mutex.runExclusive(async () => {
          if (this.state === "solving") {
            const answer = message.text as string;
            const isCorrect = this.judge(answer, message.user as string);
            if (isCorrect) {
              this.state = "solved";
              clearInterval(tickTimer);

              this.problem.solvedMessage.text = this.solvedMessageText(answer);
              await postMessage(
                Object.assign({}, this.solvedMessageGen(message), { thread_ts })
              );

              if (this.problem.answerMessage) {
                await postMessage(
                  Object.assign({}, this.problem.answerMessage, { thread_ts })
                );
              }

              result.correctAnswerer = message.user;
              result.hintIndex = hintIndex;
              result.state = "solved";
              deferred.resolve(result);
            } else {
              this.problem.incorrectMessage.text =
                this.incorrectMessageText(answer);
              await postMessage(
                Object.assign({}, this.incorrectMessageGen(message), {
                  thread_ts,
                })
              );
            }
          }
        });
      }
    });

    // Listeners should be added before postMessage is called.
    const thread_ts = this.loading.ts;
    await this.slack.chat.update(
      Object.assign(
        { ts: thread_ts },
        this.problem.problemMessage,
        this.postOption
      )
    );
    assert(typeof thread_ts === "string");

    if (this.problem.immediateMessage) {
      await postMessage(
        Object.assign({}, this.problem.immediateMessage, { thread_ts })
      );
    }
    previousHintTime = Date.now();
    const tickTimer = setInterval(onTick, 1000);

    return deferred.promise;
  }
}

const mes = {
  text: `使い方`,
  blocks: [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: "使い方",
      },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: "```座標あて <範囲の1辺の長さ(km)> <国・地域>```\nまたは\n```座標当て <範囲の1辺の長さ(km)> <国・地域>```\nをsandboxチャンネルに打つとクイズが開始されます。答えた緯度と経度の地点がが画像に写っていれば正解です。",
      },
    },
    {
      type: "header",
      text: {
        type: "plain_text",
        text: "パラメータ",
      },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*範囲の1辺の長さ*\n出題される問題では正方形(${img_size}px×${img_size}px)の衛星画像が表示されます。その正方形の1辺に対応する地球上の距離を指定できます。単位はkmです。正でない数や10000を超える数が指定された場合と指定がない場合は1000kmに設定されます。`,
      },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: "*国・地域*\n出題される問題の中心点の位置を国・地域単位で限定できます。国・地域の先頭に-を付けるとその国・地域を除外します。指定がない場合、世界全体が設定されます。-付きの国・地域のみが指定された場合、世界全体からそれらの国・地域を除いた範囲に設定されます。",
      },
    },
    {
      type: "header",
      text: {
        type: "plain_text",
        text: "注意点・その他",
      },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: "画像の中心点は陸上に限定されています。Google Mapのズームの限界値より小さい範囲を指定した場合は、Google Mapのズームの限界値の範囲となります。\n解答では度分秒形式はサポートしていません。35度7分30秒であれば35.125のように小数で答えてください。また、北緯、南緯、東経、西経はそれぞれN, S, E, Wで表し、数字の前につけてください。小文字でもよいです。N, S, E, W, n, s, e, wのいずれもついていない数字は緯度、経度の順で解釈され、それぞれ正の数が北緯あるいは東経、負の数が南緯あるいは西経と解釈します。\n*例*\nN65.4E34.8 → 北緯65.4度東経34.8度\n24.6 -98.4 → 北緯24.6度西経98.4度\nw 178.5,32.9 → 北緯32.9度西経178.5度（wが付いている数字が経度と解釈され、残った数字が緯度と解釈されます。アルファベットの後にスペースがあってもよいです。）\n134.9 s17.6 → 南緯17.6度東経134.9度（sが付いている数字が緯度と解釈され、残った数字が経度と解釈されます。）",
      },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: "`座標当て countries`あるいは `座標あて countries`と入力すると、対応している国・地域の一覧が見られます。",
      },
    },
  ],
  channel: CHANNEL,
};

function countriesExpand(
  countriesOriginal: string[],
  aliases: Record<string, string[]>
) {
  const countries = countriesOriginal.concat();
  let countriesLength = 0;

  while (countries.length !== countriesLength) {
    countriesLength = countries.length;
    for (let i = 0; i < countriesLength; i++) {
      if (aliases.hasOwnProperty(countries[i])) {
        countries.push(...aliases[countries[i]]);
        countries[i] = "-";
      }
      if (
        countries[i].startsWith("-") &&
        aliases.hasOwnProperty(countries[i].slice(1))
      ) {
        countries.push(
          ...Array.from(aliases[countries[i].slice(1)], (x: string) => "-" + x)
        );
        countries[i] = "-";
      }
    }
  }
  return countries;
}

function countriesListGen(aliases: Record<string, string[]>): string[] {
  const arr = [];

  const aliasesString = [];

  let aliasesStringLength = 0;

  for (const [key, value] of Object.entries(aliases)) {
    const addString = `*${key}* → ${value.sort().join(" ")}`;
    if (aliasesStringLength + addString.length <= 2000) {
      aliasesString.push(addString);
      aliasesStringLength += addString.length;
    } else {
      arr.push(aliasesString.join("\n"));
      aliasesString.splice(0);
      aliasesStringLength = 0;
    }
  }
  arr.push(aliasesString.join("\n"));
  return arr;
}

const postOptions = JSON.parse(
  JSON.stringify({
    username: "coord-quiz",
    icon_emoji: ":globe_with_meridians:",
  })
);

async function puppeteerWindow(
  latitude: number,
  longitude: number,
  zoom: number
): Promise<Record<string, any>> {
  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  await page.setViewport({
    width: img_size,
    height: img_size,
    deviceScaleFactor: 1,
  });
  await page.setContent(
    `
		<head>
			<style>
				body {
					margin: 0px;
					width: ${img_size}px;
					height: ${img_size}px;
				}
				#map_canvas {
					width: ${img_size}px;
					height: ${img_size}px;
				}
			</style>
			<script async src='https://maps.googleapis.com/maps/api/js?key=${API_KEY}&v=beta&callback=initMap'></script>
			<script>	
				let result;	
				async function initMap() {
					const maxZoomService = new google.maps.MaxZoomService();
					const latLng = new google.maps.LatLng(${latitude},${longitude});
					await maxZoomService.getMaxZoomAtLatLng(
						latLng, (maxZoom) => {result = maxZoom.zoom }
						)
					const map = new google.maps.Map(
						document.getElementById('map_canvas')
						, {
						center: { lat: ${latitude}, lng: ${longitude}},
						zoom: Math.min(${zoom},result),
						mapTypeId: 'satellite',
						isFractionalZoomEnabled: true,
						gestureHandling: 'none',
						disableDefaultUI: true,
						disableDoubleClickZoom: true,
						keyboardShortcuts: false,
						scrollwheel: false,
						}
					);
				}
			</script>
		</head>	
		<body><div id='map_canvas'></div></body>
		`,
    { waitUntil: "networkidle0" }
  );
  const maxZoom = (await page.evaluate("result")) as number;
  const image = (await page.screenshot({
    encoding: "binary",
    type: "png",
  })) as Buffer;
  await browser.close();
  return { zoom: Math.min(maxZoom, zoom), image: image };
}

function latLngFormat(lat: number, lng: number): string {
  let latStr: string, lngStr: string;
  if (lat < 0) {
    latStr = `S ${-lat}°`;
  } else {
    latStr = `N ${lat}°`;
  }
  if (lng < 0) {
    lngStr = `W ${-lng}°`;
  } else {
    lngStr = `E ${lng}°`;
  }
  return `${latStr} ${lngStr}`;
}

function latLngDeformat(str: string): [number, number] | null {
  const lat_regex = /(?<sign>[ns])\s*(?<number>\d+\.?\d*|\.\d+)/i;
  const lng_regex = /(?<sign>[we])\s*(?<number>\d+\.?\d*|\.\d+)/i;
  const regex = /(?<sign>[+-]?)\s*(?<number>\d+\.?\d*|\.\d+)/i;
  const lat_result = str.match(lat_regex)
    ? str.match(lat_regex).groups
    : str.match(regex)
    ? str.match(regex).groups
    : (undefined as { sign: string; number: string } | undefined);
  str = str.replace(
    new RegExp(lat_result.sign + "\\s*" + lat_result.number, "i"),
    ""
  );
  console.log(str);
  const lng_result = str.match(lng_regex)
    ? str.match(lng_regex).groups
    : str.match(regex)
    ? str.match(regex).groups
    : (undefined as { sign: string; number: string } | undefined);
  if (!lat_result) return null;
  if (!lng_result) return null;
  let lat = parseFloat(lat_result.number);
  let lng = parseFloat(lng_result.number);
  if (lat > 90 || lng > 180) return null;
  const lat_sign = lat_result.sign.toLowerCase();
  const lng_sign = lng_result.sign.toLowerCase();
  if (lat_sign === "s" || lat_sign === "-") lat = -lat;
  if (lng_sign === "w" || lng_sign === "-") lng = -lng;
  return [lat, lng];
}

function latLngToMercator(lat: number, lng: number): number[] {
  const x = (lng / 180) * Math.PI;
  const y =
    Math.log(
      (1 + Math.sin((lat / 180) * Math.PI)) /
        (1 - Math.sin((lat / 180) * Math.PI))
    ) / 2;
  return [x, y];
}

function polarToCartesian(phi: number, theta: number): number[] {
  const x = Math.cos(phi) * Math.cos(theta);
  const y = Math.cos(phi) * Math.sin(theta);
  const z = Math.sin(phi);
  return [x, y, z];
}

function randomPoint(size: number): number[] {
  while (true) {
    const x = Math.random() * 2 - 1;
    const y = Math.random() * 2 - 1;
    const z = Math.random() * 2 - 1;
    const r = (x ** 2 + y ** 2 + z ** 2) ** 0.5;
    if (0 < r && r < 1) {
      const lat = (Math.asin(z / r) / Math.PI) * 180;
      const lng = (Math.atan2(x / r, y / r) / Math.PI) * 180;
      if (Math.abs(lat) < 80 - size / 2 / ((6378.137 * Math.PI) / 180)) {
        return [lat, lng];
      }
    }
  }
}

function distFormat(num: number): string {
  if (num >= 10) {
    return `${Math.round(num)}km`;
  } else if (num >= 1) {
    return `${num.toFixed(1)}km`;
  } else {
    return `${Math.round(num * 1000)}m`;
  }
}

export default async ({ eventClient, webClient: slack }: SlackInterface) => {
  const aliases = (await fs.readJson(
    __dirname + "/country_names.json"
  )) as Record<string, string[]>;

  const countriesList = countriesExpand(["世界"], aliases)
    .filter((country) => country !== "-")
    .sort();

  const aliasesStringArray = countriesListGen(aliases);

  eventClient.on("message", async (message) => {
    if (
      message.channel !== CHANNEL ||
      message.thread_ts ||
      !(
        message.text?.startsWith("座標当て") ||
        message.text?.startsWith("座標あて")
      )
    ) {
      return;
    }

    const messageTs = JSON.parse(JSON.stringify({ thread_ts: message.ts }));

    if (message.text.indexOf("help") !== -1) {
      await slack.chat.postMessage(
        Object.assign({}, mes, postOptions, messageTs)
      );
      return;
    }

    if (message.text.indexOf("countries") !== -1) {
      const mes = {
        thread_ts: message.ts,
        text: "国・地域一覧",
        blocks: [
          {
            type: "header",
            text: {
              type: "plain_text",
              text: "国・地域一覧",
            },
          },
          {
            type: "section",
            text: {
              type: "plain_text",
              text: countriesList.join("\n"),
            },
          },
          {
            type: "header",
            text: {
              type: "plain_text",
              text: "使用可能な別名",
            },
          },
          ...Array.from(aliasesStringArray, (text: string) => {
            return { type: "section", text: { type: "mrkdwn", text: text } };
          }),
        ],
        channel: CHANNEL,
      };
      await slack.chat.postMessage(Object.assign({}, mes, postOptions));
      return;
    }

    const loading = await slack.chat.postMessage(
      Object.assign({ channel: CHANNEL, text: "問題を生成中..." }, postOptions)
    );

    const reNum = /[+-]?(\d+\.?\d*|\.\d+)/;

    let size =
      message.text.match(reNum) === null
        ? 1000
        : parseFloat(message.text.match(reNum)[0]) > 10000 ||
          parseFloat(message.text.match(reNum)[0]) <= 0
        ? 1000
        : Math.abs(parseFloat(message.text.match(reNum)[0]));

    let countriesOriginal: string[] = message.text
      .slice(4)
      .replaceAll(new RegExp(reNum, "g"), "")
      .trim()
      .split(/\s+/)
      .filter((str: string) => str !== "");

    if (
      countriesOriginal.filter((country) => !country.startsWith("-")).length ===
      0
    ) {
      countriesOriginal.push("世界");
    }

    countriesOriginal.forEach((country, index) => {
      if (countriesOriginal.includes("-" + country)) {
        countriesOriginal[index] = "-";
      }
    });

    const countries = countriesExpand(countriesOriginal, aliases);

    countries.forEach((country, index) => {
      if (countries.includes("-" + country)) {
        countries[index] = "-";
      }
    });

    countries.forEach((country, index) => {
      if (country.startsWith("-")) {
        countries[index] = "-";
      }
    });

    const world = await fs.readJson(__dirname + "/countries.geojson");

    const worldFilter = Object.create(world);

    worldFilter.features = worldFilter.features.filter((feature: any) =>
      countries.includes(feature.properties.NAME_JA)
    );

    let invalidCounter = 0;
    let validCounter = 0;

    let errorTextArray = [];

    for (let i = 0; i < countries.length; i++) {
      if (
        countries[i] !== "-" &&
        world.features.find(
          (feature: any) => feature.properties.NAME_JA === countries[i]
        ) === undefined
      ) {
        invalidCounter += 1;
        errorTextArray.push(
          `「${
            countriesOriginal[i] === undefined
              ? countries[i]
              : countriesOriginal[i]
          }」という国・地域はないよ:anger:\n`
        );
      } else if (countries[i] !== "-") {
        validCounter += 1;
      }
    }
    if (validCounter === 0) {
      errorTextArray.push(`当てはまる場所がないよ:anger:\n`);
    }
    if (invalidCounter !== 0 || validCounter === 0) {
      const mes = {
        text: errorTextArray.join("\n"),
        channel: CHANNEL,
      };
      await slack.chat.postMessage(Object.assign({}, mes, postOptions));
      return;
    }

    let zoom: number,
      img_url: string,
      window: Record<string, any>,
      latitude: number,
      longitude: number,
      country: any;
    while (true) {
      [latitude, longitude] = randomPoint(size);
      const points = Turf.points([[longitude, latitude]]);
      const resArr = worldFilter.features.filter(
        (country: any) =>
          Turf.pointsWithinPolygon(points, country).features.length > 0
      );
      if (resArr.length > 0) {
        country = resArr[0];
        zoom = Math.log2(
          (156543.03392 * img_size * Math.cos((latitude * Math.PI) / 180)) /
            size /
            1000
        );
        window = await puppeteerWindow(latitude, longitude, zoom);
        zoom = window.zoom;
        const result: any = await new Promise((resolve, reject) => {
          cloudinary.v2.uploader
            .upload_stream(
              { resource_type: "image" },
              (error: any, data: any) => {
                if (error) {
                  reject(error);
                } else {
                  resolve(data);
                }
              }
            )
            .end(window.image);
        });
        img_url = result.secure_url;
        size =
          (156543.03392 * img_size * Math.cos((latitude * Math.PI) / 180)) /
          2 ** zoom /
          1000;
        break;
      }
    }
    if (mutex.isLocked()) {
      slack.chat.postMessage(
        Object.assign(
          {
            channel: CHANNEL,
            text: "今クイズ中だよ:angry:",
          },
          messageTs,
          postOptions
        )
      );
      return;
    }
    const answer = latLngFormat(latitude, longitude);
    const problem = {
      problemMessage: {
        channel: CHANNEL,
        text: `緯度と経度を当ててね。サイズは${distFormat(size)}四方だよ。`,
        blocks: [
          {
            type: "section",
            text: {
              type: "plain_text",
              text: `緯度と経度を当ててね。サイズは${distFormat(
                size
              )}四方だよ。`,
            },
          },
          {
            type: "image",
            image_url: img_url,
            alt_text: "Map cannot be displayed.",
          },
        ],
      },
      hintMessages: [
        {
          channel: CHANNEL,
          text: `画像の中心点は${country.properties.NAME_JA}にあるよ:triangular_flag_on_post:`,
        },
      ],
      immediateMessage: { channel: CHANNEL, text: "制限時間: 300秒" },
      solvedMessage: {
        channel: CHANNEL,
        text: ``,
        reply_broadcast: true,
      },
      incorrectMessage: {
        channel: CHANNEL,
        text: ``,
      },
      unsolvedMessage: {
        channel: CHANNEL,
        text: `もう、しっかりして！\n中心点の座標は ${answer} だよ:anger:\nhttps://maps.google.co.jp/maps?ll=${latitude},${longitude}&q=${latitude},${longitude}&&t=k`,
        reply_broadcast: true,
      },
      correctAnswers: [answer, zoom.toString()],
    };

    const ateQuiz = new CoordAteQuiz(
      eventClient,
      slack,
      problem,
      loading,
      postOptions
    );

    const startTime = Date.now();

    const result = await mutex.runExclusive(async () => {
      return ateQuiz.start();
    });

    const endTime = Date.now();

    if (result.state === "solved") {
      await increment(result.correctAnswerer, "coord-quiz-easy-answer");
      if (size < 20.00001) {
        await increment(
          result.correctAnswerer,
          "coord-quiz-professional-answer"
        );
      }
      if (size <= 100.00001) {
        await increment(result.correctAnswerer, "coord-quiz-hard-answer");
      }
      if (size <= 500.00001) {
        await increment(result.correctAnswerer, "coord-quiz-medium-answer");
      }
      if (endTime - startTime <= 30000) {
        await increment(result.correctAnswerer, "coord-quiz-30sec-answer");
      }
    }
  });
};
