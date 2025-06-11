// AlpacaHack

import axios from "axios";
import { Challenge, SolvedInfo, Profile } from "./BasicTypes";

const client = axios.create({
	withCredentials: false,
});

export const fetchChallsAH = async function (): Promise<Challenge[]> {
	try {
		const { data: json } = await client.get(
			"https://alpacahack.com/challenges?_data=routes%2F_root.challenges",
			{
				headers: {},
			}
		);
		return json.challenges.map(
			(chall: any): Challenge => ({
				id: "?", // not available
				name: chall.name,
				score: 0, // not available
			})
		);
	} catch {
		return null;
	}
};

export const fetchUserProfileAH = async function (
	userId: string
): Promise<Profile> {
	try {
		const { data: json } = await client.get(
			`https://alpacahack.com/users/${userId}?_data=routes%2F_root.users_.%24userName`,
			{
				headers: {},
			}
		);
		return {
			username: json.name,
			country: json.country,
			rank: "?",
			score: json.submissions
				.filter((sub: any) => sub.isCorrect)
				.length.toString(),
			comment: "",
			registeredAt: "", // not available
			solvedChalls: json.submissions
				.filter((sub: any) => sub.isCorrect)
				.map(
					(sub: any): SolvedInfo => ({
						id: "", // not available
						solvedAt: new Date(sub.createdAt.value),
						name: sub.challenge.name,
						score: 0, // not available
					})
				),
		};
	} catch {
		return null;
	}
};

export const findUserByNameAH = async function (
	username: string
): Promise<{ userid: string; name: string }> {
	try {
		const { data: json } = await client.get(
			`https://alpacahack.com/users/${username}?_data=routes%2F_root.users_.%24userName`,
			{
				headers: {},
			}
		);
		return {
			userid: json.name,
			name: json.name,
		};
	} catch {
		return null;
	}
};
