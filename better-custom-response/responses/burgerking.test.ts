import burgerking from "./burgerking";

const regex = /^(.*)(てくれや|でくれや)[。⋯・…]*$/;

const match = (text: string): string[] => {
    const result = regex.exec(text);
    if (result === null) {
        throw new Error('Custom response pattern not match');
    }
    return result;
};

describe('better-custom-response', () => {
    describe('burgerking', () => {
        it('burgerking', async () => {
            expect(await burgerking(match('バーガーキング下北沢店作ってくれや'))).toStrictEqual(['作ってんで！']);
            expect(await burgerking(match('本当のこと言ってくれや'))).toStrictEqual(['言ってんで！']);
            expect(await burgerking(match('今すぐ死んでくれや'))).toStrictEqual(['死んでんで！']);
            expect(await burgerking(match('予測してくれや'))).toStrictEqual(['予測してんで！']);
        });
    });
});
