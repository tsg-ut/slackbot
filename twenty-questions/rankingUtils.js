"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getRankEmoji = exports.getRankedPlayers = void 0;
const getRankedPlayers = (players) => {
    const sortedPlayers = [...players].sort((a, b) => a.score - b.score);
    const rankedPlayers = [];
    let currentRank = 1;
    let previousScore = null;
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
exports.getRankedPlayers = getRankedPlayers;
const getRankEmoji = (rank) => {
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
exports.getRankEmoji = getRankEmoji;
