import * as Turf from "@turf/turf";
import fs from "fs-extra";
import type { SlackInterface } from "../lib/slack";
import puppeteer from "puppeteer";
import { AteQuizProblem, AteQuizResult } from "../atequiz";
import {
  ChatPostMessageArguments,
  WebAPICallOptions,
  WebClient,
} from "@slack/web-api";
import { increment } from "../achievements";
import { TeamEventClient } from "../lib/slackEventClient";
const { Mutex } = require("async-mutex");
const { AteQuiz } = require("../atequiz/index.ts");
const cloudinary = require("cloudinary");

const API_KEY = process.env.GOOGLE_MAPS_API_KEY;
const CHANNEL = process.env.CHANNEL_SANDBOX;
const mutex = new Mutex();

const img_size = 1000;

const radius_of_earth = 6378.137;

const postOptions = {
  username: "coord-quiz",
  icon_emoji: ":globe_with_meridians:",
};

const reNum = /[+-]?(\d+\.?\d*|\.\d+)/;

interface CoordAteQuizProblem extends AteQuizProblem {
  answer: [number, number];
  zoom: number;
  size: number;
}

class CoordAteQuiz extends AteQuiz {
  static option?: WebAPICallOptions = postOptions;
  ngReaction: string | null = null;
  constructor(
    eventClient: TeamEventClient,
    slack: WebClient,
    problem: CoordAteQuizProblem
  ) {
    super(
      { eventClient: eventClient, webClient: slack },
      problem,
      CoordAteQuiz.option
    );
    this.answeredUsers = new Set();
  }
  judge(answer: string, _user: string) {
    if (latLngDeformat(answer) === null) {
      return false;
    }
    const [lat, lng] = latLngDeformat(answer);
    const [latans, lngans] = this.problem.answer;
    const [xm, ym] = latLngToMercator(lat, lng);
    const [xmans, ymans] = latLngToMercator(latans, lngans);
    const zoom = this.problem.zoom;
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

  solvedMessageGen(post: any): ChatPostMessageArguments {
    const message = { ...this.problem.solvedMessage };
    const userAnswer = post.text;
    const [lat, lng] = latLngDeformat(userAnswer);
    const [latans, lngans] = this.problem.answer;
    const distance = measureDistance(lat, lng, latans, lngans);
    message.text = `<@[[!user]]> 正解:tada:\n中心点の座標は ${latLngFormat(
      this.problem.answer[0],
      this.problem.answer[1]
    )} 、中心点までの距離は${distFormat(
      distance
    )}だよ:muscle:\nhttps://maps.google.co.jp/maps?ll=${latans},${lngans}&q=${latans},${lngans}&t=k
			`;
    message.text = message.text.replaceAll(
      this.replaceKeys.correctAnswerer,
      post.user as string
    );
    return message;
  }

  incorrectMessageGen(post: any): ChatPostMessageArguments {
    const message = { ...this.problem.incorrectMessage };
    const userAnswer = post.text;
    if (latLngDeformat(userAnswer) === null) {
      message.text = `<@[[!user]]> 解答形式が間違っているよ:cry:`;
    } else {
      const [lat, lng] = latLngDeformat(userAnswer);
      const [latans, lngans] = this.problem.answer;
      const distance = measureDistance(lat, lng, latans, lngans);
      message.text = `<@[[!user]]> 不正解:x:\n中心点までの距離は${distFormat(
        distance
      )}だよ:cry:`;
    }
    message.text = message.text.replaceAll(
      this.replaceKeys.correctAnswerer,
      post.user as string
    );
    return message;
  }

  waitSecGen(hintIndex: number): number {
    return hintIndex === this.problem.hintMessages.length ? 180 : 120;
  }
}

const mesHelp = {
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

function countriesListMessageGen(aliases: Record<string, string[]>): any {
  const countriesList = countriesExpand(["世界"], aliases)
    .filter((country) => country !== "-")
    .sort();

  const aliasesStringArray = countriesListGen(aliases);

  const mesCountries = {
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
  return mesCountries;
}

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
    : undefined;
  if (!lat_result) return null;
  str = str.replace(
    new RegExp(lat_result.sign + "\\s*" + lat_result.number, "i"),
    ""
  );
  const lng_result = str.match(lng_regex)
    ? str.match(lng_regex).groups
    : str.match(regex)
    ? str.match(regex).groups
    : undefined;
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

function latLngToCartesian(lat: number, lng: number): number[] {
  const phi = (lat / 180) * Math.PI;
  const theta = (lng / 180) * Math.PI;
  const x = Math.cos(phi) * Math.cos(theta);
  const y = Math.cos(phi) * Math.sin(theta);
  const z = Math.sin(phi);
  return [x, y, z];
}

function measureDistance(
  lat: number,
  lng: number,
  latans: number,
  lngans: number
): number {
  const [x, y, z] = latLngToCartesian(lat, lng);
  const [xans, yans, zans] = latLngToCartesian(latans, lngans);
  const distance = Math.acos(x * xans + y * yans + z * zans) * radius_of_earth;
  return distance;
}

function deg2Rad(deg: number): number {
  return (deg * Math.PI) / 180;
}
function rad2Deg(rad: number): number {
  return (rad * 180) / Math.PI;
}

function randomPoint(extent: number[]): number[] {
  let [minx, miny, maxx, maxy] = [...extent];
  maxy = Math.min(80, maxy);
  miny = Math.max(-80, miny);
  const lng = Math.random() * (maxx - minx) + minx;
  const lat = rad2Deg(
    Math.asin(
      Math.random() * (Math.sin(deg2Rad(maxy)) - Math.sin(deg2Rad(miny))) +
        Math.sin(deg2Rad(miny))
    )
  );
  return [lat, lng];
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

function sizeExtract(text: string): number {
  const size =
    text.match(reNum) === null
      ? 1000
      : parseFloat(text.match(reNum)[0]) > 10000 ||
        parseFloat(text.match(reNum)[0]) <= 0
      ? 1000
      : parseFloat(text.match(reNum)[0]);
  return size;
}

function countriesExtract(
  text: string,
  aliases: Record<string, string[]>
): [string[], string] {
  const countriesList = countriesExpand(["世界"], aliases)
    .filter((country) => country !== "-")
    .sort();
  let countriesOriginal: string[] = text
    .slice(4)
    .replaceAll(new RegExp(reNum, "g"), "")
    .trim()
    .split(/\s+/)
    .filter((str: string) => str !== "");

  if (
    countriesOriginal.filter((country) => !country.startsWith("-")).length === 0
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

  let validCounter = 0;

  let errorTextArray = [];

  for (let i = 0; i < countries.length; i++) {
    if (
      countries[i] !== "-" &&
      !countriesList.includes(countries[i].replace("-", ""))
    ) {
      errorTextArray.push(
        `「${
          countriesOriginal[i] === undefined
            ? countries[i]
            : countriesOriginal[i]
        }」という国・地域はないよ:anger:`
      );
    } else if (countries[i] !== "-") {
      validCounter += 1;
    }
  }
  if (validCounter === 0) {
    errorTextArray.push(`当てはまる場所がないよ:anger:`);
  }
  return [countries, errorTextArray.join("\n")];
}
async function problemGen(
  size: number,
  worldFilter: any
): Promise<[any, number, number, string, number, number]> {
  let country: any,
    zoom: number,
    img_url: string,
    latitude: number,
    longitude: number;
  const extent = Turf.bbox(worldFilter);
  while (true) {
    [latitude, longitude] = randomPoint(extent);
    const points = Turf.points([[longitude, latitude]]);
    const resArr = worldFilter.features.filter(
      (country: any) =>
        Turf.pointsWithinPolygon(points, country).features.length > 0
    );
    if (resArr.length > 0) {
      country = resArr[0];
      zoom = Math.log2(
        (((radius_of_earth * 1000 * 2 * Math.PI) / 256) *
          img_size *
          Math.cos((latitude * Math.PI) / 180)) /
          size /
          1000
      );
      const window = await puppeteerWindow(latitude, longitude, zoom);
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
        (((radius_of_earth * 1000 * 2 * Math.PI) / 256) *
          img_size *
          Math.cos((latitude * Math.PI) / 180)) /
        2 ** zoom /
        1000;
      break;
    }
  }
  return [country, zoom, size, img_url, latitude, longitude];
}

function problemFormat(
  country: any,
  zoom: number,
  size: number,
  img_url: string,
  latitude: number,
  longitude: number
) {
  const answer = latLngFormat(latitude, longitude);

  const problem: CoordAteQuizProblem = {
    problemMessage: {
      channel: CHANNEL,
      text: `緯度と経度を当ててね。サイズは${distFormat(size)}四方だよ。`,
      blocks: [
        {
          type: "section",
          text: {
            type: "plain_text",
            text: `緯度と経度を当ててね。サイズは${distFormat(size)}四方だよ。`,
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
    answer: [latitude, longitude],
    zoom: zoom,
    size: size,
    answerMessage: null,
    correctAnswers: [] as string[],
  };
  return problem;
}

async function prepareProblem(
  slack: any,
  message: any,
  aliases: Record<string, string[]>,
  world: any
) {
  await slack.chat.postEphemeral({
    channel: CHANNEL,
    text: "問題を生成中...",
    user: message.user,
    ...postOptions,
  });

  const sizeOrig = sizeExtract(message.text);

  const [countries, errorText] = countriesExtract(message.text, aliases);

  if (errorText.length > 0) {
    await slack.chat.postMessage({
      text: errorText,
      channel: CHANNEL,
      ...postOptions,
    });
    return;
  }

  const worldFilter = Object.create(world);

  worldFilter.features = worldFilter.features.filter((feature: any) =>
    countries.includes(feature.properties.NAME_JA)
  );

  const [country, zoom, sizeActual, img_url, latitude, longitude] =
    await problemGen(sizeOrig, worldFilter);

  const problem: CoordAteQuizProblem = problemFormat(
    country,
    zoom,
    sizeActual,
    img_url,
    latitude,
    longitude
  );
  return problem;
}

export default async ({ eventClient, webClient: slack }: SlackInterface) => {
  const aliases = (await fs.readJson(
    __dirname + "/country_names.json"
  )) as Record<string, string[]>;

  const world = await fs.readJson(__dirname + "/countries.geojson");
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
    const messageTs = { thread_ts: message.ts };

    if (message.text.includes("help")) {
      await slack.chat.postMessage({
        ...mesHelp,
        ...postOptions,
        ...messageTs,
      });
      return;
    }

    if (message.text.includes("countries")) {
      await slack.chat.postMessage({
        ...countriesListMessageGen(aliases),
        ...postOptions,
        ...messageTs,
      });
      return;
    }

    if (mutex.isLocked()) {
      slack.chat.postMessage({
        channel: CHANNEL,
        text: "今クイズ中だよ:angry:",
        ...messageTs,
        ...postOptions,
      });
      return;
    }

    let result: any, startTime: number, size: number;

    await mutex.runExclusive(async () => {
      await Promise.any([
        (async () => {
          const problem: CoordAteQuizProblem = await prepareProblem(
            slack,
            message,
            aliases,
            world
          );

          const ateQuiz = new CoordAteQuiz(eventClient, slack, problem);
          const st = Date.now();
          const res = await ateQuiz.start();

          result = res;
          startTime = st;
          size = problem.size;
        })(),
        (async () => {
          await new Promise((resolve) => {
            return setTimeout(resolve, 600 * 1000);
          });
        })(),
      ]);
    });

    const endTime = Date.now();

    if (!result) return;

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
