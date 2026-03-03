import {
  ChatPostMessageArguments,
  GenericMessageEvent,
} from "@slack/web-api";
import fs from "fs";
import path from "path";
import puppeteer from "puppeteer";
import sqlite3 from "sqlite3";
import { increment } from '../achievements';
import { AteQuiz, AteQuizProblem } from "../atequiz";
import { normalize } from "../hayaoshi";
import { ChannelLimitedBot } from '../lib/channelLimitedBot';
import logger from "../lib/logger";
import type { SlackInterface } from "../lib/slack";
import { Deferred } from '../lib/utils';
const { Mutex } = require("async-mutex");
const cloudinary = require("cloudinary");

const API_KEY = process.env.GOOGLE_MAPS_API_KEY;
if (!API_KEY) {
  throw new Error("Google Maps API key is missing from .env file.");
}
if (!process.env.CLOUDINARY_URL) {
  throw new Error("Cloudinary URL is missing from .env file.");
}

const postOptions = {
  username: "NMPZ-quiz",
  icon_emoji: ":rainbolt:",
};

interface Coordinate {
  pano_id: string;
  lat: number;
  lng: number;
  heading: number;
  pitch: number;
  country_code: string;
}

interface Country {
  country_code: string;
  region: string;
  subregion: string;
  name_official: string;
  name_common: string;
}

const coordToURL = ({ lat, lng, heading, pitch }: Coordinate) =>
  `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${lat},${lng}&heading=${heading}&pitch=${pitch}`;

const coordToStr = (lat: number, lng: number) =>
  `${Math.abs(lat).toFixed(4)}${lat >= 0 ? "N" : "S"}, ${Math.abs(lng).toFixed(4)}${lng >= 0 ? "E" : "W"}`;

let coordinates: { db: sqlite3.Database };
const initDatabase = async (dbPath: string) => {
  coordinates = {
    db: new sqlite3.Database(dbPath)
  };
};
const getRandomCoordinate = async () => new Promise((resolve, reject) => {
  coordinates.db.get("SELECT * FROM coordinates ORDER BY RANDOM() LIMIT 1", (err, row) => {
    if (err) {
      reject(err);
    } else {
      resolve(row);
    }
  });
});

const getCountryName = async (country_code: string): Promise<Country> => new Promise((resolve, reject) => {
  const url = "https://raw.githubusercontent.com/mledoze/countries/master/countries.json";
  fetch(url)
    .then((response) => response.json())
    .then((data: any[]) => {
      const country = data.find((c: any) => c.cca2 === country_code.toUpperCase());
      if (!country) {
        reject(new Error("Country not found"));
        return;
      }
      const region = country.region;
      const subregion = country.subregion;
      const name_official = country.translations.jpn.official;
      const name_common = country.translations.jpn.common;
      resolve({ country_code, region, subregion, name_official, name_common });
    })
    .catch((error) => {
      reject(error);
    });
});

const generateHTML = ({ lat, lng, heading, pitch }: Coordinate): string => `
  <!DOCTYPE html>
  <html lang="en">
    <head>
      <meta charset="UTF-8" />
      <title>Street View Screenshot</title>
      <style>
        #map {
          height: 100%;
        }
        html, body {
          height: 100%;
          margin: 0;
          padding: 0;
        }
        #compass {
          position: absolute;
          bottom: 30px;
          left: 30px;
          width: 120px;
          height: 120px;
          border-radius: 50%;
          background-color: rgba(0, 0, 0, 0.6);
          z-index: 1000;
        }
        .needle {
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          width: 30px;
          height: 90px;
          background: linear-gradient(to bottom, red 50%, white 50%);
          clip-path: polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%);
        }
      </style>
      <script>
        async function initPano() {
          const panorama = new google.maps.StreetViewPanorama(
            document.getElementById("map"), {
            position: { lat: ${lat}, lng: ${lng} },
            pov: { heading: ${heading}, pitch: ${pitch} },
            zoom: 0,
            addressControl: false,
            linksControl: false,
            panControl: false,
            fullscreenControl: false,
            zoomControl: false,
            enableCloseButton: false,
            showRoadLabels: false
          });
          
          const compassElement = document.getElementById('compass');
          if (compassElement) {
            compassElement.style.transform = 'rotate(' + ${-heading} + 'deg)';
          }
        }
        window.initPano = initPano;
      </script>
      <script async defer src="https://maps.googleapis.com/maps/api/js?key=${API_KEY}&callback=initPano"></script>
    </head>
    <body>
      <div id="map"></div>
      <div id="compass">
        <div class="needle"></div>
      </div>
    </body>
  </html>
`;
const saveHTML = async (coord: Coordinate, outputPath = "template.html"): Promise<void> => {
  const htmlContent = generateHTML(coord);
  const filePath = path.resolve("nmpz", outputPath);
  await fs.promises.writeFile(filePath, htmlContent, "utf8");
  logger.info(`HTML file saved at: ${filePath}`);
};

async function captureStreetViewScreenshot(coord: Coordinate): Promise<string> {
  saveHTML(coord);

  const browser = await puppeteer.launch({
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox"
    ],
    headless: true,
    defaultViewport: {
      width: 1920,
      height: 1080
    }
  });
  const page = await browser.newPage();

  const url = `file://${process.cwd()}/nmpz/template.html`;
  try {
    try {
      await page.goto(url, { waitUntil: "networkidle0" });
    }
    catch (error) {
      logger.error("Error loading page:", error);
    }

    // upload screenshot to Cloudinary
    const result: any = await new Promise((resolve, reject) => {
      page.screenshot({ fullPage: true, type: "jpeg", quality: 90 }).then((data) => {
        cloudinary.v2.uploader.upload_stream({ resource_type: "image" }, (error: any, result: any) => {
          if (error) {
            reject(error);
          } else {
            resolve(result);
          }
        }).end(data);
      });
    });
    await browser.close();

    return result.secure_url;
  } catch (error) {
    logger.error("Error capturing screenshot:", error);
    throw error;
  }
}

interface NmpzAteQuizProblem extends AteQuizProblem {
  answer: string;
}

class NmpzAteQuiz extends AteQuiz {
  judge(answer: string, _user: string) {
    const normalizedAnswer = normalize(answer);
    const normalizedCorrectAnswers = this.problem.correctAnswers.map(normalize);
    return normalizedCorrectAnswers.some(
      (normalizedCorrectAnswer: string): boolean => normalizedAnswer === normalizedCorrectAnswer
    );
  }

  waitSecGen(hintIndex: number): number {
    return hintIndex <= this.problem.hintMessages.length - 1 ? 30 : 90;
  }
}

async function problemGen(): Promise<[Country, number, number, string, string]> {
  const row = await getRandomCoordinate() as Coordinate;
  const country_code = row.country_code;
  logger.info(row);
  const country = await getCountryName(country_code);
  logger.info(country);
  const img_url = await captureStreetViewScreenshot(row);
  logger.info(img_url);
  const answer_url = coordToURL(row);

  return [country, row.lat, row.lng, img_url, answer_url];
}

function problemFormat(
  country: Country,
  lat: number,
  lng: number,
  img_url: string,
  answer_url: string,
  thread_ts: string,
  channel: string
): NmpzAteQuizProblem {
  const emoji = `:flag-${country.country_code}:`;
  const problem: NmpzAteQuizProblem = {
    problemMessage: {
      channel,
      thread_ts,
      text: `どこの国でしょう？`,
      blocks: [
        {
          type: "section",
          text: {
            type: "plain_text",
            text: `どこの国でしょう？`,
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
        channel,
        text: `ヒント: 画像の地域は${country.region}だよ。`,
      },
      {
        channel,
        text: `ヒント: 画像の地域は${country.subregion}だよ。`,
      },
    ],
    immediateMessage: { channel, text: "" },
    solvedMessage: {
      channel,
      text: `<@[[!user]]> 正解！:tada: 正解地点は <${answer_url}|${coordToStr(lat, lng)}> だよ ${emoji}`,
      reply_broadcast: true,
      thread_ts,
      unfurl_links: false,
      unfurl_media: false,
    },
    unsolvedMessage: {
      channel,
      text: `残念！:cry: 正解は${country.name_official}、正解地点は <${answer_url}|${coordToStr(lat, lng)}> だよ ${emoji}`,
      reply_broadcast: true,
      thread_ts,
      unfurl_links: false,
      unfurl_media: false,
    },
    answer: country.name_official,
    correctAnswers: [country.name_official, country.name_common],
  };
  problem.immediateMessage.text = `制限時間: ${problem.hintMessages.length * 30 + 90}秒`;
  return problem;
}

async function prepareProblem(
  slack: any,
  message: any,
  thread_ts: string,
  channel: string
) {
  await slack.chat.postEphemeral({
    channel,
    text: "問題を生成中...",
    user: message.user,
    ...postOptions,
  });

  const [country, lat, lng, img_url, answer_url] = await problemGen();
  const problem: NmpzAteQuizProblem = problemFormat(country, lat, lng, img_url, answer_url, thread_ts, channel);
  return problem;
}

const mutex = new Mutex();

class NmpzBot extends ChannelLimitedBot {
  protected override readonly wakeWordRegex = /^NMPZ$/;

  protected override readonly username = 'NMPZ-quiz';

  protected override readonly iconEmoji = ':rainbolt:';

  protected override onWakeWord(message: GenericMessageEvent, channel: string): Promise<string | null> {
    const quizMessageDeferred = new Deferred<string | null>();

    if (mutex.isLocked()) {
      this.postMessage({
        channel,
        text: '今クイズ中だよ:angry:',
        thread_ts: message.ts,
      });
      return Promise.resolve(null);
    }

    mutex.runExclusive(async () => {
      try {
        const result = await Promise.race([
          (async () => {
            const problem: NmpzAteQuizProblem = await prepareProblem(this.slack, message, message.ts, channel);
            const ateQuiz = new NmpzAteQuiz(this.slackClients, problem, {
              username: this.username,
              icon_emoji: this.iconEmoji,
            });
            return ateQuiz.start({
              mode: 'normal',
              onStarted(startMessage) {
                quizMessageDeferred.resolve(startMessage.ts!);
              },
            });
          })(),
          new Promise<never>((_, reject) => {
            setTimeout(() => reject(new Error('タイムアウト: クイズが600秒以内に終了しませんでした')), 600 * 1000);
          }),
        ]);

        await this.deleteProgressMessage(await quizMessageDeferred.promise);

        if (result.state === 'solved') {
          await increment(result.correctAnswerer, 'nmpz-country-answer');
          if (result.hintIndex === 0) {
            await increment(result.correctAnswerer, 'nmpz-country-no-hint-answer');
          }
          if ((result.quiz as NmpzAteQuizProblem).answer === 'タイ王国') {
            await increment(result.correctAnswerer, 'nmpz-country-thailand-answer');
          }
        }
      } catch (error: any) {
        this.log.error('Failed to start NMPZ quiz', error);
        this.postMessage({
          channel,
          text: `問題生成中にエラーが発生しました: ${error.message}`,
        });
        quizMessageDeferred.resolve(null);
      }
    });

    return quizMessageDeferred.promise;
  }
}

export default async function nmpz(slackClients: SlackInterface) {
  await initDatabase('nmpz/coordinates.db');
  return new NmpzBot(slackClients);
}
