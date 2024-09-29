// User information
export interface User {
  slackId: string,
  idCtf: string, // can be empty to represent only user itself
  selfSolvesWeekly?: number,
  longestStreak?: number,
  currentStreak?: number,
}

// Achievement Type
export enum AchievementType {
  RATIO = 0, // half and all
  COUNT = 1, // 5, 10, 20, 50 problems
}

// Site Information
export interface Contest{
  id: number,
  url: string,
  title: string,
  alias: string[],
  achievementType: AchievementType,
  numChalls: number,
  joiningUsers: User[],
  achievementStr?: string,
  fetchUserProfile?: (_username: string) => Promise<Profile>,
  findUserByName?: (_username: string) => Promise<{ userid: string, name: string }>,
  fetchChalls?: () => Promise<Challenge[]>,
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
