import {WebClient} from '@slack/web-api';
import {DynamoDB, S3} from 'aws-sdk';
import axios from 'axios';
import {chunk} from 'lodash';
import {runWith, config as getConfig, logger} from 'firebase-functions/v1';

const config = getConfig();

const slack = new WebClient(config.slack.token);

const db = new DynamoDB.DocumentClient({
	region: 'ap-northeast-1',
	credentials: {
		secretAccessKey: config.aws.secret_access_key,
		accessKeyId: config.aws.access_key_id,
	},
});

const s3 = new S3({
	credentials: {
		secretAccessKey: config.aws.secret_access_key,
		accessKeyId: config.aws.access_key_id,
	},
});

const cronJob = async () => {
	let page = 1;

	while (true) {
		await new Promise((resolve) => setTimeout(resolve, 1000));
		const filesList = await slack.files.list({
			page,
			count: 100,
		});

		if (!filesList.files) {
			throw new Error('files not found');
		}

		logger.info(`Retrieved ${filesList.files.length} files (page = ${page})`);

		if (filesList.files.length === 0) {
			break;
		}

		const {Responses: slackFilesResponse} = await db.batchGet({
			RequestItems: {
				'slack-files': {
					Keys: filesList.files.map((file) => ({id: file.id})),
				},
			},
		}).promise();

		if (!slackFilesResponse) {
			throw new Error('slack-files dynamodb table not found');
		}

		const existingFiles = new Set(slackFilesResponse['slack-files'].map((file) => file.id));
		const files = filesList.files.filter((file) => (
			!existingFiles.has(file.id) && typeof file.url_private_download === 'string'
		));

		logger.info(`${files.length} files are not saved`);

		for (const fileChunk of chunk(filesList.files, 25)) {
			await db.batchWrite({
				RequestItems: {
					'slack-files': fileChunk.map((file) => ({
						PutRequest: {
							Item: file,
						},
					})),
				},
			}).promise();

			logger.info(`Saved ${fileChunk.length} file metadata`);
		}

		for (const file of files) {
			logger.info(`Downloading file (id = ${file.id}, size = ${file.size})...`);

			await new Promise((resolve) => setTimeout(resolve, 1000));
			const fileResponse = await axios({
				method: 'GET',
				url: file.url_private_download,
				responseType: 'arraybuffer',
				headers: {
					Authorization: `Bearer ${config.slack.token}`,
				},
				validateStatus: () => true,
			});

			if (fileResponse.status !== 200) {
				if (fileResponse.status === 404) {
					logger.info(`Warning: Status code 404 for URL ${file.url_private_download}. Continuing...`);
				} else {
					throw new Error(`Error: File response status code ${fileResponse.status}`);
				}
			}

			await s3.putObject({
				Body: fileResponse.data,
				Bucket: 'tsgbot-slack-files',
				Key: file.id!,
				ContentType: file.mimetype,
				StorageClass: 'INTELLIGENT_TIERING',
			}).promise();
		}

		if (existingFiles.size > 0) {
			logger.info('Reached to the end of the unsaved files. Exiting...');
			break;
		}

		page++;
	}
};

export const slackFileArchiveCronJob = 
	runWith({
		timeoutSeconds: 300,
		memory: '1GB',
	})
	.pubsub.schedule('every 60 minutes')
	.onRun(async () => {
		try {
			await cronJob();
		} catch (error) {
			console.error(error);
		}
	});