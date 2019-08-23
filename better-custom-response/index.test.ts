import customResponses from "./custom-responses";

discribe('better-custom-response', () => {
    it('either one of array and function', async () => {
        for (const customResponse of customResponses) {
            expect((customResponse.outputFunction !== undefined) !== (customResponse.outputArray !== undefined));
        }
    });
});
