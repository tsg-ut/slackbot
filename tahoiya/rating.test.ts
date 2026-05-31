import {calculateRatingDeltas} from './rating';

describe('calculateRatingDeltas', () => {
	it('returns empty array for no scores', () => {
		expect(calculateRatingDeltas([], {})).toEqual([]);
	});

	it('gives positive delta to winner with low rating', () => {
		const scores = [
			{userId: 'U1', coins: 5},
			{userId: 'U2', coins: 2},
			{userId: 'U3', coins: -1},
		];
		const ratings = {U1: 0, U2: 0, U3: 0};
		const deltas = calculateRatingDeltas(scores, ratings);

		const winner = deltas.find((d) => d.userId === 'U1')!;
		const loser = deltas.find((d) => d.userId === 'U3')!;

		expect(winner.delta).toBeGreaterThan(0);
		expect(winner.newRating).toBeGreaterThan(0);
		expect(loser.delta).toBeLessThan(0);
	});

	it('gives smaller delta at high rating', () => {
		const lowRatingScores = [{userId: 'U1', coins: 5}, {userId: 'U2', coins: 0}];
		const highRatingScores = [{userId: 'U3', coins: 5}, {userId: 'U4', coins: 0}];

		const lowDeltas = calculateRatingDeltas(lowRatingScores, {U1: 100, U2: 100});
		const highDeltas = calculateRatingDeltas(highRatingScores, {U3: 850, U4: 850});

		const lowWinner = lowDeltas.find((d) => d.userId === 'U1')!;
		const highWinner = highDeltas.find((d) => d.userId === 'U3')!;

		expect(lowWinner.delta).toBeGreaterThan(highWinner.delta);
	});

	it('clamps rating to 0 minimum', () => {
		const scores = [{userId: 'U1', coins: -10}, {userId: 'U2', coins: 10}];
		const ratings = {U1: 0, U2: 500};
		const deltas = calculateRatingDeltas(scores, ratings);

		const loser = deltas.find((d) => d.userId === 'U1')!;
		expect(loser.newRating).toBeGreaterThanOrEqual(0);
	});

	it('clamps rating to 1000 maximum', () => {
		const scores = [{userId: 'U1', coins: 100}, {userId: 'U2', coins: -100}];
		const ratings = {U1: 999, U2: 0};
		const deltas = calculateRatingDeltas(scores, ratings);

		const winner = deltas.find((d) => d.userId === 'U1')!;
		expect(winner.newRating).toBeLessThanOrEqual(1000);
	});

	it('handles tie in ranking with average rank', () => {
		const scores = [
			{userId: 'U1', coins: 5},
			{userId: 'U2', coins: 5},
			{userId: 'U3', coins: 0},
		];
		const ratings = {U1: 200, U2: 200, U3: 200};
		const deltas = calculateRatingDeltas(scores, ratings);

		const tied1 = deltas.find((d) => d.userId === 'U1')!;
		const tied2 = deltas.find((d) => d.userId === 'U2')!;

		expect(tied1.delta).toBeCloseTo(tied2.delta, 5);
	});

	it('uses 0 as default rating for unknown users', () => {
		const scores = [{userId: 'unknown', coins: 5}, {userId: 'U2', coins: 0}];
		const deltas = calculateRatingDeltas(scores, {});

		const unknown = deltas.find((d) => d.userId === 'unknown')!;
		expect(unknown.oldRating).toBe(0);
	});
});
