import customResponses from "./custom-responses";

expect(customResponses.every((customResponse) => {(customResponse.outputArray !== undefined) !== (customResponse.outputFunction !== undefined)}));
