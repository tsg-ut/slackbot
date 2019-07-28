import {WebClient, RTMClient} from '@slack/client';

export interface SlackInterface {
	rtmClient: RTMClient,
	webClient: WebClient,
}

export interface Standings {
	Fixed: boolean,
	AdditionalColumns: null,
	TaskInfo: {
		Assignment: string,
		TaskName: string,
		TaskScreenName: string,
	}[],
	StandingsData: StandingDatum[],
}

interface StandingDatum {
	Rank: number,
	Additional: null,
	UserName: string,
	UserScreenName: string,
	UserIsDeleted: boolean,
	Affiliation: string,
	Country: string,
	Rating: number,
	OldRating: number,
	IsRated: boolean,
	Competitions: number,
	TaskResults: {
		[name: string]: {
			Count: number,
			Failure: number,
			Penalty: number,
			Score: number,
			Elapsed: number,
			Status: 1 | 10,
			Pending: boolean,
			Frozen: boolean,
			Additional: null,
		},
	},
	TotalResult: {
		Count: number,
		Accepted: number,
		Penalty: number,
		Score: number,
		Elapsed: number,
		Frozen: boolean,
		Additional: null,
	},
}

interface Result {
	IsRated: boolean,
	Place: number,
	OldRating: number,
	NewRating: number,
	Performance: number,
	ContestName: string,
	ContestNameEn: string,
	ContestScreenName: string,
	EndTime: string,
	UserName: string,
	UserScreenName: string,
	Country: string,
	Affiliation: string,
	Rating: number,
	Competitions: number,
}

export type Results = Result[];

