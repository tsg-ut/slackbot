

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
        name: "fullsplit"
    },
];

export default responseAchievements;