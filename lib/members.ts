import {RTMClient, WebClient} from '@slack/client';

const teams = new Map<string, {members: any[], membersMap: Map<string, User>}>();

type User = {id: string};

export const Members = async ({webClient: slack, rtmClient: rtm}: {rtmClient: RTMClient, webClient: WebClient,}) => {
    if(teams.has(slack.token)) {
        return teams.get(slack.token);
    } else {
        const {members}: {members: any[]} = await slack.users.list() as any;
        const membersMap = new Map(members.map((member: User) => [member.id, member]));

        rtm.on('user_change', ({user}: {user: User}) => {
            // on change of user's profile
            Object.assign(membersMap.get(user.id), user);
        })

        rtm.on('team_join', ({user}: {user: User}) => {
            // on new user
            membersMap.set(user.id, user);
            members.push(user);
        })

        return {members, membersMap};
    }
};
