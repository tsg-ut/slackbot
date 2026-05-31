import {clamp, minBy, maxBy, mean} from 'lodash';

export interface GameScore {
	userId: string;
	coins: number;
}

export interface RatingDelta {
	userId: string;
	oldRating: number;
	newRating: number;
	delta: number;
}

export const calculateRatingDeltas = (
	scores: GameScore[],
	ratings: Record<string, number>,
): RatingDelta[] => {
	if (scores.length === 0) {
		return [];
	}

	const N = scores.length;
	const minCoins = minBy(scores, (s) => s.coins)!.coins;
	const maxCoins = maxBy(scores, (s) => s.coins)!.coins;

	// Sort by coins descending to determine ranks
	const sorted = [...scores].sort((a, b) => b.coins - a.coins);

	const getRank = (userId: string): number => {
		const idx = sorted.findIndex((s) => s.userId === userId);
		// Handle ties: average rank of tied group
		const coin = sorted[idx].coins;
		const tiedIndices = sorted
			.map((s, i) => (s.coins === coin ? i : -1))
			.filter((i) => i >= 0);
		return mean(tiedIndices) + 1; // 1-indexed
	};

	return scores.map((score) => {
		const currentRating = ratings[score.userId] ?? 0;
		const rank = getRank(score.userId);

		const rankScore = (N - rank) / Math.max(N - 1, 1);
		const coinScore = (score.coins - minCoins) / Math.max(maxCoins - minCoins, 1);

		const performance = 0.6 * rankScore + 0.4 * coinScore;
		const K = Math.max(10, 80 * (1 - currentRating / 1000));
		const rawDelta = K * (performance - 0.5) * 2;
		const newRating = clamp(currentRating + rawDelta, 0, 1000);

		return {
			userId: score.userId,
			oldRating: currentRating,
			newRating,
			delta: rawDelta, // Return raw (unclamped) delta for display purposes
		};
	});
};
