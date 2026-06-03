import path from 'path';
import axios from 'axios';
import nodePersist from 'node-persist';

interface AtCoderProblemsSubmission {
	id: number,
	epoch_second: number,
	problem_id: string,
	contest_id: string,
	user_id: string,
	language: string,
	point: number,
	length: number,
	result: string,
	execution_time: number,
}

interface UserSubmissionCache {
	lastFetchedSecond: number,
	acsByContest: {[contestId: string]: string[]},
}

let storagePromise: Promise<nodePersist.LocalStorage> | null = null;

const getStorage = (): Promise<nodePersist.LocalStorage> => {
	if (!storagePromise) {
		const storage = nodePersist.create({
			dir: path.resolve(__dirname, '__state__'),
		});
		storagePromise = storage.init().then(() => storage);
	}
	return storagePromise;
};

export const fetchUserACsInContest = async (userId: string, contestId: string): Promise<Set<string>> => {
	const storage = await getStorage();

	const cacheKey = `submissions-${userId}`;
	const cached: UserSubmissionCache = (await storage.getItem(cacheKey)) ?? {
		lastFetchedSecond: 0,
		acsByContest: {},
	};

	let fromSecond = cached.lastFetchedSecond > 0 ? cached.lastFetchedSecond + 1 : 0;
	let maxEpochSecond = cached.lastFetchedSecond;

	while (true) {
		const {data} = await axios.get<AtCoderProblemsSubmission[]>(
			'https://kenkoooo.com/atcoder/atcoder-api/v3/user/submissions',
			{params: {user: userId, from_second: fromSecond}},
		);

		for (const sub of data) {
			if (sub.epoch_second > maxEpochSecond) {
				maxEpochSecond = sub.epoch_second;
			}
			if (sub.result === 'AC') {
				if (!cached.acsByContest[sub.contest_id]) {
					cached.acsByContest[sub.contest_id] = [];
				}
				if (!cached.acsByContest[sub.contest_id].includes(sub.problem_id)) {
					cached.acsByContest[sub.contest_id].push(sub.problem_id);
				}
			}
		}

		if (data.length < 500) {
			break;
		}

		fromSecond = Math.max(...data.map((s) => s.epoch_second)) + 1;
		await new Promise<void>((resolve) => {
			setTimeout(resolve, 1000);
		});
	}

	cached.lastFetchedSecond = maxEpochSecond;
	await storage.setItem(cacheKey, cached);

	return new Set(cached.acsByContest[contestId] ?? []);
};
