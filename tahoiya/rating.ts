import {clamp, minBy, maxBy, mean} from 'lodash-es';

export interface GameScore {
	userId: string;
	score: number;
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
	const minScore = minBy(scores, (s) => s.score)!.score;
	const maxScore = maxBy(scores, (s) => s.score)!.score;

	const sorted = [...scores].sort((a, b) => b.score - a.score);

	const getRank = (userId: string): number => {
		const idx = sorted.findIndex((s) => s.userId === userId);
		// Handle ties: average rank of tied group
		const sc = sorted[idx].score;
		const tiedIndices = sorted
			.map((s, i) => (s.score === sc ? i : -1))
			.filter((i) => i >= 0);
		return mean(tiedIndices) + 1; // 1-indexed
	};

	return scores.map((score) => {
		const currentRating = ratings[score.userId] ?? 0;
		const rank = getRank(score.userId);

		const rankScore = (N - rank) / Math.max(N - 1, 1);
		const scoreScore = (score.score - minScore) / Math.max(maxScore - minScore, 1);

		const performance = 0.6 * rankScore + 0.4 * scoreScore;
		const baseK = Math.max(10, 80 * (1 - currentRating / 1000));
		// Scale K by participant count: sqrt(N/5) so 5 players = baseline, more = stronger changes
		const participantScale = Math.sqrt(N / 5);
		const rawDelta = baseK * participantScale * (performance - 0.5) * 2;
		const newRating = clamp(currentRating + rawDelta, 0, 1000);

		return {
			userId: score.userId,
			oldRating: currentRating,
			newRating,
			delta: rawDelta, // Return raw (unclamped) delta for display purposes
		};
	});
};
