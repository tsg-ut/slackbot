// eslint-disable-next-line import/no-namespace
import * as Turf from '@turf/turf';
import fs from 'fs-extra';
import type {SlackInterface} from '../lib/slack';
import puppeteer from "puppeteer";
import { AteQuizResult } from "../atequiz";
import { ChatPostMessageArguments, FilesUploadArguments, WebAPICallOptions, WebClient } from "@slack/web-api";
import assert from "assert";
import { increment } from "../achievements";
import { Deferred } from "../lib/utils";
import { TeamEventClient } from "../lib/slackEventClient";
const {Mutex} = require('async-mutex');
const {AteQuiz} = require('../atequiz/index.ts');
const cloudinary = require('cloudinary');


const API_KEY = "AIzaSyCMCEQdxYeU8yVPbhu4u58Ugk8BOogv1Bg"

// hakatashiのやつ
// const API_KEY = "AIzaSyCOZhs7unM1rAup82uEjzTd-BLApvqwcQE"

const mutex = new Mutex();

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
		eventClient:TeamEventClient, 
		slack: WebClient,
		problem: CoordAteQuizProblem,
		option?: WebAPICallOptions) {
		super({ eventClient, webClient: slack }, problem, option);
		this.answeredUsers = new Set();
	}
	
	judge(answer: string, _user: string){
		if (latLngDeformat(answer) === null){
			return false;
		} else{
			const [lat, lng] = latLngDeformat(answer);
			const [latans, lngans] = latLngDeformat(this.problem.correctAnswers[0]);
			const [xm, ym] = latLngToMercator(lat, lng);
			const [xmans, ymans] = latLngToMercator(latans,lngans); 
			const zoom = parseFloat(this.problem.correctAnswers[1]);
			const dist = Math.PI / 128 * 250 / (2**zoom);
			if (Math.cos(xm-xmans) >=  Math.cos(dist) && Math.abs(ym-ymans) <= dist){
				return true;
			} else {
				return false;
			}
		}
	}

	incorrectMessageText(userAnswer: string,){
		if (latLngDeformat(userAnswer) === null){
			return `<@[[!user]]> 解答形式が間違っているよ:cry:`;
		} else{
			const [lat, lng] = latLngDeformat(userAnswer);
			const [latans, lngans] = latLngDeformat(this.problem.correctAnswers[0]);
			const [x, y, z] = polarToCartesian(lat / 180 * Math.PI, lng / 180 * Math.PI)
			const [xans, yans, zans] = polarToCartesian(latans / 180 * Math.PI, lngans / 180 * Math.PI)
			const distance = Math.acos(x*xans+y*yans+z*zans)*6378.137
			return `<@[[!user]]> 不正解:x:\n中心点までの距離は${distFormat(distance)}だよ:cry:`;
		}
	}
	solvedMessageText(userAnswer: string){
			const [lat, lng] = latLngDeformat(userAnswer);
			const [latans, lngans] = latLngDeformat(this.problem.correctAnswers[0]);
			const [x, y, z] = polarToCartesian(lat / 180 * Math.PI, lng / 180 * Math.PI)
			const [xans, yans, zans] = polarToCartesian(latans / 180 * Math.PI, lngans / 180 * Math.PI)
			const distance = Math.acos(x*xans+y*yans+z*zans)*6378.137
			return `<@[[!user]]> 正解:tada:\n中心点の座標は ${this.problem.correctAnswers[0]} 、中心点までの距離は${distFormat(distance)}だよ:muscle:\n	https://maps.google.co.jp/maps?ll=${latans},${lngans}&q=${latans},${lngans}&t=k
			`;
		}

	incorrectMessageGen(post: any): ChatPostMessageArguments {
		const message = Object.assign({}, this.problem.incorrectMessage);
		message.text = message.text.replaceAll(this.replaceKeys.correctAnswerer, post.user as string);
		return message;
	  }

	waitSecGen(hintIndex: number): number {
		return hintIndex === this.problem.hintMessages.length ? 180 : 120;
	  }

	async start(): Promise<AteQuizResult> {
		this.state = 'solving';
	
		const postMessage = (
		  message: ChatPostMessageArguments
		) => {
			const toSend = Object.assign({}, message, this.postOption);
		    return this.slack.chat.postMessage(toSend);
		};
	
		const result: AteQuizResult = {
		  quiz: this.problem,
		  state: 'unsolved',
		  correctAnswerer: null,
		  hintIndex: null,
		};
	
		let previousHintTime : number = null;
		let hintIndex = 0;
	
		const deferred = new Deferred<AteQuizResult>();
	
		const onTick = () => {
		  this.mutex.runExclusive(async () => {
			const now = Date.now();
			const nextHintTime =
			  previousHintTime + 1000 * this.waitSecGen(hintIndex);
			if (this.state === 'solving' && nextHintTime <= now) {
			  previousHintTime = now;
			  if (hintIndex < this.problem.hintMessages.length) {
				const hint = this.problem.hintMessages[hintIndex];
				await postMessage(Object.assign({}, hint, { thread_ts }));
				hintIndex++;
			  } else {
				this.state = 'unsolved';
				await postMessage(
				  Object.assign({}, this.problem.unsolvedMessage, { thread_ts })
				);
	
				if (this.problem.answerMessage){
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
	
		this.eventClient.on('message', async (message: any) => {
		  if (message.thread_ts === thread_ts) {
			if (message.subtype === 'bot_message' || message.subtype === 'file_share') return;
			this.mutex.runExclusive(async () => {
			  if (this.state === 'solving') {
				const answer = message.text as string;
				const isCorrect = this.judge(answer, message.user as string);
				if (isCorrect) {
				  this.state = 'solved';
				  clearInterval(tickTimer);
					
				  this.problem.solvedMessage.text = this.solvedMessageText(answer);
				  await postMessage(
					Object.assign({}, this.solvedMessageGen(message), { thread_ts })
				  );
				  
				  if (this.problem.answerMessage){
					await postMessage(
					  Object.assign({}, this.problem.answerMessage, { thread_ts })
					);
				  }
	
				  result.correctAnswerer = message.user;
				  result.hintIndex = hintIndex;
				  result.state = 'solved';
				  deferred.resolve(result);
				} else {
				  this.problem.incorrectMessage.text = this.incorrectMessageText(answer);
				  await postMessage(
					Object.assign({}, this.incorrectMessageGen(message), { thread_ts })
				  );
				  
				}
			  }
			});
		  }
		});
	
		// Listeners should be added before postMessage is called.
		const { ts: thread_ts } = await postMessage(this.problem.problemMessage);
		assert(typeof thread_ts === 'string');
	
		if (this.problem.immediateMessage){
		  await postMessage(
			Object.assign({}, this.problem.immediateMessage, { thread_ts })
		  );
		}
		previousHintTime = Date.now();
		const tickTimer = setInterval(onTick, 1000);
	
		return deferred.promise;
	  }
}

const postOptions = JSON.parse(JSON.stringify({username: 'coord-quiz', icon_emoji: ':globe_with_meridians:'}));

async function puppeteerWindow(latitude: number, longitude: number, zoom: number): Promise<Record<string, any>>{
	const browser = await puppeteer.launch();
	const page = await browser.newPage();
	await page.setViewport({
		width: 1000,
		height: 1000,
		deviceScaleFactor: 1,
	});     
	await page.setContent(
		`
		<head>
			<style>
				body {
					margin: 0px;
					width: 1000px;
					height: 1000px;
				}
				#map_canvas {
					width: 1000px;
					height: 1000px;
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
		`,{waitUntil: "networkidle0"}
	);
	const maxZoom = await page.evaluate("result") as number;
	const image = await page.screenshot({fromSurface: true, encoding: 'binary', type: 'png'}) as Buffer;
	await browser.close();
	return {zoom: Math.min(maxZoom,zoom), image: image}
}

function latLngFormat(lat: number, lng: number): string{
	let latStr: string, lngStr: string;
	if (lat < 0){
		latStr = `S ${-lat}°`
	} else {
		latStr = `N ${lat}°`
	}
	if (lng < 0){
		lngStr = `W ${-lng}°`
	} else {
		lngStr = `E ${lng}°`
	}
	return `${latStr} ${lngStr}`
}

function latLngDeformat(str: string): number[] | null{
	let lat: number, lng: number;
	if (str.match(/[Nn]\s*(\d+\.?\d*|\.\d+)/) !== null){
		lat = parseFloat(str.match(/[Nn]\s*(?<number>\d+\.?\d*|\.\d+)/).groups.number);
	} else if (str.match(/[Ss]\s*(\d+\.?\d*|\.\d+)/) !== null){
		lat = -parseFloat(str.match(/[Ss]\s*(?<number>\d+\.?\d*|\.\d+)/).groups.number);
	}
	if (str.match(/[Ee]\s*(\d+\.?\d*|\.\d+)/) !== null){
		lng = parseFloat(str.match(/[Ee]\s*(?<number>\d+\.?\d*|\.\d+)/).groups.number);
	} else if (str.match(/[Ww]\s*(\d+\.?\d*|\.\d+)/) !== null){
		lng = -parseFloat(str.match(/[Ww]\s*(?<number>\d+\.?\d*|\.\d+)/).groups.number);
	}
	if (lat === undefined && str.match(/[+-]?\s*\d+\.?\d*|\.\d+/) !== null){
		lat = parseFloat(str.match(/[+-]?\s*\d+\.?\d*|\.\d+/)[0].replaceAll(/\s/g,""));
		str = str.replace(/[+-]?\s*\d+\.?\d*|\.\d+/,"");
	}
	if (lng === undefined && str.match(/[+-]?\s*\d+\.?\d*|\.\d+/) !== null){
		lng = parseFloat(str.match(/[+-]?\s*\d+\.?\d*|\.\d+/)[0].replaceAll(/\s/g,""));
	}
	if (lat === undefined || lng === undefined || Math.abs(lat) > 90 || Math.abs(lng) > 180 ){
		return null;
	} else {
		return [lat, lng];
	}
}

function latLngToMercator(lat: number, lng: number): number[]{
	const x = lng / 180 * Math.PI;
	const y = (Math.log((1 + Math.sin(lat / 180 * Math.PI))/(1 - Math.sin(lat / 180 * Math.PI))))/ 2;
	return [x,y];
}

function polarToCartesian(phi: number, theta: number): number[]{
	const x = Math.cos(phi) * Math.cos(theta);
	const y = Math.cos(phi) * Math.sin(theta);
	const z = Math.sin(phi);
	return [x, y, z]
}

function randomPoint(size: number): number[]{
	while (true){
		const x = Math.random() * 2 - 1;
		const y = Math.random() * 2 - 1;
		const z = Math.random() * 2 - 1;
		const r = (x**2 + y**2 + z**2)**0.5
		if (0 < r && r < 1){
			const lat = Math.asin(z/r) / Math.PI * 180;
			const lng = Math.atan2(x/r,y/r) / Math.PI * 180;
			if (Math.abs(lat) < 80 - size / 2 / (6378.137 * Math.PI / 180)){
				return [lat,lng];
			}
		}
	}
}

function strReplace(str: string): string{
	return str
	.replaceAll("・","")
	.replaceAll("ヴァ","バ")
	.replaceAll("ヴィ","ビ")
	.replaceAll("ヴェ","ベ")
	.replaceAll("ヴォ","ボ")
	.replaceAll("ヴ","ブ");
}

function distFormat(num: number): string{
	if (num >= 10){
		return `${Math.round(num)}km`
	} else if (num >= 1){
		return `${Math.round(num * 10).toString().slice(0,-1)}.${Math.round(num * 10).toString().slice(-1)}km`
	} else {
		return `${Math.round(num * 1000).toString()}m`
	}
}


export default ({eventClient, webClient: slack}: SlackInterface) => {
	eventClient.on('message', async (message) => {
		if (message.channel !== process.env.CHANNEL_SANDBOX || !(message.text?.startsWith('座標当て') || message.text?.startsWith('座標あて') )) {
			return;
		}
		
		if (message.text.indexOf("help") !== -1){
			const mes ={
				thread_ts: message.ts,
				text: `使い方`, 
				blocks: [
					{
						"type": "header",
						"text": {
							"type": "plain_text",
							"text": "使い方"
						}
					},
					{
						"type": "section",
						"text": {
							"type": "mrkdwn",
							"text": "```座標あて <範囲の1辺の長さ(km)> <国・地域>```\nまたは\n```座標当て <範囲の1辺の長さ(km)> <国・地域>```\nをsandboxチャンネルに打つとクイズが開始されます。答えた緯度と経度の地点がが画像に写っていれば正解です。"
						}
					},
					{
						"type": "header",
						"text": {
							"type": "plain_text",
							"text": "パラメータ"
						}
					},
					{
						"type": "section",
						"text": {
							"type": "mrkdwn",
							"text": "*範囲の1辺の長さ*\n出題される問題では正方形(1000px×1000px)の衛星画像が表示されます。その正方形の1辺に対応する地球上の距離を指定できます。単位はkmです。正でない数や10000を超える数が指定された場合と指定がない場合は1000kmに設定されます。"
						}
					},
					{
						"type": "section",
						"text": {
							"type": "mrkdwn",
							"text": "*国・地域*\n出題される問題の中心点の位置を国・地域単位で限定できます。国・地域の先頭に-を付けるとその国・地域を除外します。指定がない場合、世界全体が設定されます。-付きの国・地域のみが指定された場合、世界全体からそれらの国・地域を除いた範囲に設定されます。"
						}
					},
					{
						"type": "header",
						"text": {
							"type": "plain_text",
							"text": "注意点・その他"
						}
					},
					{
						"type": "section",
						"text": {
							"type": "mrkdwn",
							"text": "画像の中心点は陸上に限定されています。Google Mapのズームの限界値より小さい範囲を指定した場合は、Google Mapのズームの限界値の範囲となります。"
						}
					},
					{
						"type": "section",
						"text": {
							"type": "mrkdwn",
							"text": "`座標当て countries`あるいは `座標あて countries`と入力すると、対応している国・地域の一覧が見られます。"
						}
					}
				],
				channel: process.env.CHANNEL_SANDBOX,
			};
			await slack.chat.postMessage(Object.assign({},mes,postOptions));
			return;
		}

		const aliases = await fs.readJson(__dirname + '/country_names.json');

		const countriesList = aliases["世界"].sort();

		const aliasesStringArray = [];
	    
		let aliasesString = ""

		for (let key in aliases){
			const addString = `*${key}* → ${aliases[key].join(" ")}\n`;
			if (aliasesString.length + addString.length <= 2000){
				aliasesString += addString;
			} else {
				aliasesStringArray.push(aliasesString.slice(0,-1));
				aliasesString = addString;
			}
		}

		aliasesStringArray.push(aliasesString.slice(0,-1));

		if (message.text.indexOf("countries") !== -1){
			const mes = {
				thread_ts: message.ts,
				text: "国・地域一覧",
				blocks: [
					{
						"type": "header",
						"text": {
							"type": "plain_text",
							"text": "国・地域一覧"
						}
					},
					{
						"type": "section",
						"text": {
							"type": "plain_text",
							"text": countriesList.join("\n")
						}
					},
					{
						"type": "header",
						"text": {
							"type": "plain_text",
							"text": "使用可能な別名"
						}
					},
					...(Array.from(
						aliasesStringArray, 
						(text: string) => { return {"type": "section","text": {"type": "mrkdwn","text": text}}}
						))
				],
				channel: process.env.CHANNEL_SANDBOX,
			}
			await slack.chat.postMessage(Object.assign({},mes,postOptions));
			return;
		}

		

		const reNum = /[+-]?(?:\d+\.?\d*|\.\d+)/;

		let size = message.text.match(reNum) === null ? 1000 : parseFloat(message.text.match(reNum)[0]) > 10000 || parseFloat(message.text.match(reNum)[0]) <= 0 ? 1000 : Math.abs(parseFloat(message.text.match(reNum)[0]));

		if (size >= 10){
			size = Math.round(size)
		} else {
			size = Math.round(size * 10) / 10.0
		}

		

		let countriesOriginal: string[] = message.text.slice(4).replaceAll(new RegExp(reNum, "g"), "").trim().split(/\s+/).filter((str: string) => str !== "");

        const countriesLength = countriesOriginal.length;

		if (countriesOriginal.filter((country) => !country.startsWith("-")).length === 0){
			countriesOriginal.push(...(aliases["世界"]))
		}

		countriesOriginal
		.forEach((country,index) => {
			if(countriesOriginal.includes("-"+country)) {
				countriesOriginal[index] = "-" 
			}
		} )

		let countries = countriesOriginal.concat();

		for (let i = 0; i < countriesLength; i++){
			countries[i] = strReplace(countries[i]);
			if (aliases.hasOwnProperty(countries[i])){
				countries.push(...(aliases[countries[i]]));
				countries[i] = "-";
			}
			if (countries[i].startsWith("-") && aliases.hasOwnProperty(countries[i].slice(1))){
				countries.push(...(Array.from(aliases[countries[i].slice(1)], (x: string) => "-" + x)));
				countries[i] = "-";
			}
		}

		countries.forEach((country,index) => {
			countries[index] = strReplace(countries[index]);
			if(countries.includes("-"+country)) {
				countries[index] = "-" 
			}
		} )

		countries.forEach((country,index) => {
			countries[index] = strReplace(countries[index]);
			if(country.startsWith("-")) {
				countries[index] = "-" 
			}
		} )


		const world = await fs.readJson(__dirname + '/countries.geojson');


		const worldFilter = Object.create(world)
		
		worldFilter.features = worldFilter.features.filter((feature: any) => countries.includes(strReplace(feature.properties.NAME_JA)));

		let invalidCounter = 0;
		
		let errorText = '';
		
		for (let i = 0; i < countries.length; i++){
			if (countries[i] !== "-" && world.features.find((feature: any) => strReplace(feature.properties.NAME_JA) === countries[i]) === undefined) {
				invalidCounter += 1
				errorText += `「${countriesOriginal[i] === undefined ? countries[i] : countriesOriginal[i]}」という国・地域はないよ:anger:\n`
			}
		}
		if (invalidCounter !== 0) {
			const mes = {
					text: errorText.slice(0,-1),
					channel: process.env.CHANNEL_SANDBOX,
			};
			await slack.chat.postMessage(Object.assign({},mes,postOptions));
			return;
		} 

		let zoom: number, imgbuffer: Buffer, img_url: string, window: Record<string,any>, latitude: number, longitude: number, country: any;
		while (true) {
			[latitude, longitude] = randomPoint(size);
			const points = Turf.points([[longitude, latitude]]);
			const resArr = worldFilter.features.filter((country: any) => Turf.pointsWithinPolygon(points, country).features.length > 0 );
			if (resArr.length > 0) {
				country = resArr[0];
				zoom = Math.log2(156543.03392 * 1000 * Math.cos(latitude * Math.PI / 180)/size/1000);
				window = await puppeteerWindow(latitude,longitude,zoom)
				zoom = window.zoom;
				const result: any = await new Promise((resolve, reject) => {
					cloudinary.v2.uploader.upload_stream({ resource_type: 'image' }, (error: any, data: any) => {
						if (error) {
							reject(error);
						} else {
							resolve(data);
						}
					}).end(window.image);
				});
				img_url = result.secure_url;
				imgbuffer = window.image;
				size = 156543.03392 * 1000 * Math.cos(latitude * Math.PI / 180)/(2**zoom)/1000;
				break;
			}
		}
		if (mutex.isLocked()) {
			postMessage('今クイズ中だよ:angry:');
			return;
		}
		const channel = process.env.CHANNEL_SANDBOX;
		const answer = latLngFormat(latitude,longitude);
		const problem = {
			problemMessage: {
				channel: channel,
				text: `緯度と経度を当ててね。サイズは${distFormat(size)}四方だよ。`,
				blocks: [
					{
						"type": "section",
						"text": {
							"type": "plain_text",
							"text": `緯度と経度を当ててね。サイズは${distFormat(size)}四方だよ。`
						}
					},
					{
						"type": "image",
						"image_url": img_url,
						"alt_text": "Map cannot be displayed."
					}
				]
			},
			hintMessages: [{
				channel: channel,
				text: `画像の中心点は${country.properties.NAME_JA}にあるよ:triangular_flag_on_post:`,
			}],
			immediateMessage: {channel: channel, text: '制限時間: 300秒'},
			solvedMessage: {
				channel: channel,
				text: ``,
				reply_broadcast: true,
			},
			incorrectMessage: {
				channel: channel,
				text: ``,
			},
			unsolvedMessage: {
				channel: channel,
				text: `もう、しっかりして！\n中心点の座標は ${answer} だよ:anger:\nhttps://maps.google.co.jp/maps?ll=${latitude},${longitude}&q=${latitude},${longitude}&&t=k`,
				reply_broadcast: true,
			},
			correctAnswers: [answer,zoom.toString()],
			
		};

		const ateQuiz = new CoordAteQuiz(
			eventClient, 
			slack,
			problem,
			postOptions,
		);
        
		const startTime = Date.now();

		const result = await mutex.runExclusive(async () => {
			return ateQuiz.start();
		});

		const endTime = Date.now();

		if (result.state === 'solved') {
			await increment(result.correctAnswerer, 'coord-quiz-easy-answer');
			if (size < 20.00001) {
				await increment(result.correctAnswerer, 'coord-quiz-professional-answer');
			}
			if (size <= 100.00001) {
				await increment(result.correctAnswerer, 'coord-quiz-hard-answer');
			}
			if (size <= 500.00001) {
				await increment(result.correctAnswerer, 'coord-quiz-medium-answer');
			}
			if (endTime - startTime <= 30000) {
				await increment(result.correctAnswerer, 'coord-quiz-30sec-answer')
			}
		}
	});
};
