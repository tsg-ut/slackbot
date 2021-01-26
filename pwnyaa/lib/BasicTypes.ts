// User information
export interface User {
  slackId: string,
  idCtf: string, // can be empty to represent only user itself
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
  solvedAt: Date, //
  name: string,
  score: number,
}
