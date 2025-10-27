import type {PlayerState} from './TwentyQuestions';

export interface RankedPlayer {
	player: PlayerState;
	rank: number;
	displayRank: string;
}

export const getRankedPlayers = (players: PlayerState[]): RankedPlayer[] => {
	const sortedPlayers = [...players].sort((a, b) => a.score! - b.score!);
	const rankedPlayers: RankedPlayer[] = [];

	let currentRank = 1;
	let previousScore: number | null = null;
	let playersWithSameRank = 0;

	for (const player of sortedPlayers) {
		if (previousScore !== null && player.score !== previousScore) {
			currentRank += playersWithSameRank;
			playersWithSameRank = 0;
		}

		playersWithSameRank++;
		previousScore = player.score;

		rankedPlayers.push({
			player,
			rank: currentRank,
			displayRank: `${currentRank}位`,
		});
	}

	return rankedPlayers;
};

export const getRankEmoji = (rank: number): string => {
	switch (rank) {
		case 1:
			return ':first_place_medal:';
		case 2:
			return ':second_place_medal:';
		case 3:
			return ':third_place_medal:';
		default:
			return `${rank}位`;
	}
};
