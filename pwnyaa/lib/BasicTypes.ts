// User information
export interface User {
  slackId: string,
  idCtf: string, // can be empty to represent only user itself
  selfSolvesWeekly?: number,
  longestStreak?: number,
  currentStreak?: number,
}

// Site Information
export interface Contest{
  id: number,
  url: string,
  title: string,
  alias: string[],
  numChalls: number,
  joiningUsers: User[],
}

// Challenge information per-site
export interface Challenge {
  id: string, // determined by the site
  name: string,
  score: number, // score of the chall
}

export interface SolvedInfo{
  id: string, // challenge id
  solvedAt: Date, // UTC
  name: string,
  score: number,
}

export interface Profile{
  username: string,
  country: string,
  rank: string,
  score: string,
  comment: string,
  registeredAt: string,					// UTC
  solvedChalls: SolvedInfo[],
}
