import { stripIndent } from 'common-tags';

interface CustomResponse {
    input: RegExp[],
    outputArray?: string[],
    outputFunction?: ((input: string[]) => string[] | Promise<string[]>),
    shuffle?: true,
    username?: string,
    icon_emoji?: string,
    reaction?: true,
}

const customResponses: CustomResponse[] = [
    {
        input: [/^あほくさ$/],
        outputArray: [":ahokusa-top-left::ahokusa-top-center::ahokusa-top-right:\n:ahokusa-bottom-left::ahokusa-bottom-center::ahokusa-bottom-right:"],
        username: 'あほくさresponse',
        icon_emoji: ':atama:',
    },
    {
        input: [/^2d6$/, /^ダイス$/],
        outputArray: [":kurgm1::kurgm1:", ":kurgm1::kurgm2:", ":kurgm1::kurgm3:", ":kurgm1::kurgm4:", ":kurgm1::kurgm5:", ":kurgm1::kurgm6:", ":kurgm2::kurgm1:", ":kurgm2::kurgm2:", ":kurgm2::kurgm3:", ":kurgm2::kurgm4:", ":kurgm2::kurgm5:", ":kurgm2::kurgm6:", ":kurgm3::kurgm1:", ":kurgm3::kurgm2:", ":kurgm3::kurgm3:", ":kurgm3::kurgm4:", ":kurgm3::kurgm5:", ":kurgm3::kurgm6:", ":kurgm4::kurgm1:", ":kurgm4::kurgm2:", ":kurgm4::kurgm3:", ":kurgm4::kurgm4:", ":kurgm4::kurgm5:", ":kurgm4::kurgm6:", ":kurgm5::kurgm1:", ":kurgm5::kurgm2:", ":kurgm5::kurgm3:", ":kurgm5::kurgm4:", ":kurgm5::kurgm5:", ":kurgm5::kurgm6:", ":kurgm6::kurgm1:", ":kurgm6::kurgm2:", ":kurgm6::kurgm3:", ":kurgm6::kurgm4:", ":kurgm6::kurgm5:", ":kurgm6::kurgm6:"],
    },
    {
        input: [/^(\d+)d(\d+)$/],
        outputFunction: (input: string[]) => {
            const diceCount = Number(input[1]);
            const diceUpper = Number(input[2]);
            let retString = "";
            let result = 0;
            if (diceCount > 2000) return null;
            for (let diceIndex = 0; diceIndex < diceCount; ++diceIndex) {
                const face = Math.floor(Math.random() * diceUpper) + 1;
                retString += face.toString() + " ";
                result += face;
            }
            if(retString.length > 3000)retString = retString.slice(0, 1997) + "... ";
            retString += "= " + result.toString();
            return [retString];
        },
        username: 'dice response',
    },
    {
        input: [/^(おじぎねこ)?ファミリー$/],
        outputArray: [":ojigineko:", ":party-ojigineko-line:", ":ojigineko-superfast:", ":nameraka-ojigineko-extreme-fast:", ":ojigineko-fast:", ":ojigineko-extremefast:", ":ojigineko-pi:", ":iceojigineko:", ":ojigineko-hd:", ":ojigineko-drug:", ":dot-ojigineko:", ":ojigineko-waking:", ":party-ojigineko:", ":ojigineko-mirror:", ":ojigineko-sleeping:", ":space-ojigineko:", ":ojigiharassment:", ":ojigineko-mirror-pi:", ":magao-ojigineko:", ":nameraka-ojigineko:", ":party-ojigineko-fast:", ":quantum-ojigineko:", ":fukigen-ojigineko:", ":ojigineko-with-satos:", ":haritsuita-ojigineko:", ":harassment-ojigineko:", ":ojigineko-gokyu-kaiken:", ":ojigineko-muscle-exercise:", ":tosshutsu-symmetry-ojigineko:", ":ojigineko-upside-down:", ":ojikineko:", ":ojigineko-tired:", ":ojigineko-twin-sleeping:", ":nameraka-party-ojigineko-extremefast:", ":nameraka-ojigineko-ultraextreme-fast:", ":ojigiodoshi:", ":tashigineko:", ":dot-ojigineko:", ":tosshutsu-symmetry-rotating:", ":tosshutsu-symmetry-rotating-fast:", ":tosshutsu-symmetry-rotating-extremefast:", ":ojigineko-distorted:"],
        shuffle: true,
        icon_emoji: ':ojigineko:',
    },
    {
        input: [/((ね|ネ|ﾈ|ne)(こ|コ|ｺ|ko))|猫|cat|にゃ|nya|meow/i],
        outputArray: ['nya-n', 'neko'],
        reaction: true,
    },
    {
        input: [/@tsgcat(?![A-Za-z])/],
        outputArray: ['ねこ〜', 'すぴー'],
        icon_emoji: ':cat2:',
        username: 'tsgcat',
    },
    {
        input: [/^(.+)っちへ$/],
        outputFunction: input => [ stripIndent`
            ${input[1]}っちへ
            
            ういっすー!
            朝から、完全にぽんぽんぺいんで、つらみが深いので、1日おふとんでスヤァしておきます。
            明日は行けたら行くマンです!` ],
        icon_emoji: ':shakaijin-ichinensei:',
        username: '社会人一年生',
    },
];

export default customResponses;
