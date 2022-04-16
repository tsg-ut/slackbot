// eslint-disable-next-line import/no-namespace
import * as Turf from '@turf/turf';
import fs from 'fs-extra';
import {encode} from 'pluscodes';
import type {SlackInterface} from '../lib/slack';

const range = (lower: number, upper: number) => Math.random() * (upper - lower) + lower;

export default ({eventClient, webClient: slack}: SlackInterface) => {
	eventClient.on('message', async (message) => {
		if (message.channel !== process.env.CHANNEL_SANDBOX || !message.text?.startsWith('ダーツの旅')) {
			return;
		}

		const prefecture = message.text.slice(5).trim();

		const japan = await fs.readJson(__dirname + '/japan.geojson');

		const prefectureGeo = prefecture === '' ? japan : japan.features.find((feature: any) => (
			feature.properties.nam_ja === prefecture
		));

		if (prefectureGeo === undefined) {
			await slack.chat.postMessage({
				text: `そんな都道府県はないよ:anger:`,
				channel: process.env.CHANNEL_SANDBOX,
			});
			return;
		}

		while (true) {
			const longitude = range(120, 155);
			const latitude = range(20, 46);
			const points = Turf.points([[longitude, latitude]]);
			const res = Turf.pointsWithinPolygon(points, prefectureGeo);
			
			if (res.features.length > 0) {
				const pluscode = encode({longitude, latitude});
				const url = `https://www.google.co.jp/maps/search/${encodeURIComponent(pluscode)}`;
				const image = `https://maps.googleapis.com/maps/api/streetview?size=800x300&key=AIzaSyCOZhs7unM1rAup82uEjzTd-BLApvqwcQE&radius=10000&location=${latitude},${longitude}`;
				const direction = `https://www.google.co.jp/maps/dir/My+Location/${encodeURIComponent(pluscode)}`;
				const streetViewUrl = `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${latitude},${longitude}`;
				await slack.chat.postMessage({
					text: `${url} <${direction}|[経路案内]>`,
					channel: process.env.CHANNEL_SANDBOX,
					attachments: [
						{
							title: 'Street View',
							image_url: image,
							title_link: streetViewUrl,
						},
					],
				});
				break;
			}
		}
	});
};
