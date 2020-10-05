

interface Achievement {
    trigger: RegExp[],
    name: string,
}

const responseAchievements: Achievement[] = [
    {
        trigger: [/\|　　\|　\|　\|　\|＿\|＿\|＿\|＿\|/],
        name: "fullsplit"
    },
    {
        trigger: [/\|　　\|＿\|＿\|＿\|＿\|　\|　\|　\|/],
        name: "reversplit"
    },
];

export default responseAchievements;