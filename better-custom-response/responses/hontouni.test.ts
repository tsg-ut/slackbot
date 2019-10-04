import hontouni from "./hontouni";

const regex = /^(.*)(てます|でます|ています|でいます|ちゃった|じゃった)[。⋯・…]*$/;

const match = (text: string): string[] => {
    const result = regex.exec(text);
    if (result === null) {
        throw new Error('Custom response pattern not match');
    }
    return result;
};

describe('better-custom-response', () => {
    describe('hontouni', () => {
        it('hontouni', async () => {
            expect(await hontouni(match('言っています'))).toStrictEqual(['本当に言っていますか？']);
            expect(await hontouni(match('泣いてます'))).toStrictEqual(['本当に泣いていますか？']);
            expect(await hontouni(match('聞いちゃった'))).toStrictEqual(['本当に聞いていますか？']);
            expect(await hontouni(match('踏んでいます'))).toStrictEqual(['本当に踏んでいますか？']);
            expect(await hontouni(match('噛んでます'))).toStrictEqual(['本当に噛んでいますか？']);
            expect(await hontouni(match('死んじゃった'))).toStrictEqual(['本当に死んでいますか？']);

            expect(await hontouni(match('びっくりして死んじゃった'))).toStrictEqual(['本当に死んでいますか？']);
            expect(await hontouni(match('完璧にできています'))).toStrictEqual(['本当にできていますか？']);

            expect(await hontouni(match('泣いています⋯⋯'))).toStrictEqual(['本当に泣いていますか？']);
            expect(await hontouni(match('死んじゃった……。'))).toStrictEqual(['本当に死んでいますか？']);
        });
    });
});
