import {getRankedPlayers, getRankEmoji} from './rankingUtils';
import type {PlayerState} from './TwentyQuestions';

describe('rankingUtils', () => {
	describe('getRankedPlayers', () => {
		it('handles single player', () => {
			const players: PlayerState[] = [
				{
					userId: 'user1',
					questions: [],
					questionCount: 5,
					isFinished: true,
					score: 5,
				},
			];

			const result = getRankedPlayers(players);

			expect(result).toHaveLength(1);
			expect(result[0].rank).toBe(1);
			expect(result[0].displayRank).toBe('1位');
		});

		it('handles multiple players with different scores', () => {
			const players: PlayerState[] = [
				{
					userId: 'user1',
					questions: [],
					questionCount: 3,
					isFinished: true,
					score: 3,
				},
				{
					userId: 'user2',
					questions: [],
					questionCount: 5,
					isFinished: true,
					score: 5,
				},
				{
					userId: 'user3',
					questions: [],
					questionCount: 7,
					isFinished: true,
					score: 7,
				},
			];

			const result = getRankedPlayers(players);

			expect(result).toHaveLength(3);
			expect(result[0].player.userId).toBe('user1');
			expect(result[0].rank).toBe(1);
			expect(result[0].displayRank).toBe('1位');

			expect(result[1].player.userId).toBe('user2');
			expect(result[1].rank).toBe(2);
			expect(result[1].displayRank).toBe('2位');

			expect(result[2].player.userId).toBe('user3');
			expect(result[2].rank).toBe(3);
			expect(result[2].displayRank).toBe('3位');
		});

		it('handles tied players', () => {
			const players: PlayerState[] = [
				{
					userId: 'user1',
					questions: [],
					questionCount: 3,
					isFinished: true,
					score: 3,
				},
				{
					userId: 'user2',
					questions: [],
					questionCount: 3,
					isFinished: true,
					score: 3,
				},
				{
					userId: 'user3',
					questions: [],
					questionCount: 5,
					isFinished: true,
					score: 5,
				},
			];

			const result = getRankedPlayers(players);

			expect(result).toHaveLength(3);
			expect(result[0].player.userId).toBe('user1');
			expect(result[0].rank).toBe(1);
			expect(result[0].displayRank).toBe('1位');

			expect(result[1].player.userId).toBe('user2');
			expect(result[1].rank).toBe(1);
			expect(result[1].displayRank).toBe('1位');

			expect(result[2].player.userId).toBe('user3');
			expect(result[2].rank).toBe(3);
			expect(result[2].displayRank).toBe('3位');
		});

		it('handles multiple tied groups', () => {
			const players: PlayerState[] = [
				{
					userId: 'user1',
					questions: [],
					questionCount: 3,
					isFinished: true,
					score: 3,
				},
				{
					userId: 'user2',
					questions: [],
					questionCount: 3,
					isFinished: true,
					score: 3,
				},
				{
					userId: 'user3',
					questions: [],
					questionCount: 5,
					isFinished: true,
					score: 5,
				},
				{
					userId: 'user4',
					questions: [],
					questionCount: 5,
					isFinished: true,
					score: 5,
				},
				{
					userId: 'user5',
					questions: [],
					questionCount: 7,
					isFinished: true,
					score: 7,
				},
			];

			const result = getRankedPlayers(players);

			expect(result).toHaveLength(5);
			expect(result[0].rank).toBe(1);
			expect(result[1].rank).toBe(1);
			expect(result[2].rank).toBe(3);
			expect(result[3].rank).toBe(3);
			expect(result[4].rank).toBe(5);
		});
	});

	describe('getRankEmoji', () => {
		it('returns correct emoji for rank 1', () => {
			expect(getRankEmoji(1)).toBe(':first_place_medal:');
		});

		it('returns correct emoji for rank 2', () => {
			expect(getRankEmoji(2)).toBe(':second_place_medal:');
		});

		it('returns correct emoji for rank 3', () => {
			expect(getRankEmoji(3)).toBe(':third_place_medal:');
		});

		it('returns rank string for rank 4 and above', () => {
			expect(getRankEmoji(4)).toBe('4位');
			expect(getRankEmoji(5)).toBe('5位');
			expect(getRankEmoji(10)).toBe('10位');
		});
	});
});
