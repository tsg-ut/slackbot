import axios from 'axios';

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

export const fetchUserACsInContest = async (userId: string, contestId: string): Promise<Set<string>> => {
	const acProblems = new Set<string>();
	let fromSecond = 0;

	while (true) {
		const {data} = await axios.get<AtCoderProblemsSubmission[]>(
			'https://kenkoooo.com/atcoder/atcoder-api/v3/user/submissions',
			{params: {user: userId, from_second: fromSecond}},
		);

		for (const sub of data) {
			if (sub.contest_id === contestId && sub.result === 'AC') {
				acProblems.add(sub.problem_id);
			}
		}

		if (data.length < 500) {
			break;
		}

		const lastSecond = Math.max(...data.map((s) => s.epoch_second));
		fromSecond = lastSecond + 1;
		await new Promise<void>((resolve) => {
			setTimeout(resolve, 1000);
		});
	}

	return acProblems;
};
