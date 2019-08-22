import customResponces from "./custom-responces";

const responce = (text) => {
    const splittedText = text.replace(/ .,;:+\*<>?_}@\[`{]!"#\$%&'\(\)=~|-\^¥\\/g, ' ').split(' ');
    for (const part of splittedText) {
        for (const resp of customResponces) {
            for (const regexp of resp.input) {
                if (regexp.test(part)) {
                    if ({}.hasOwnProperty.call(resp, 'outputArray')) {
                        const resultNumber = Math.floor(Math.random() * resp.outputArray.length);
                        return resp.outputArray[resultNumber];
                    } else {
                        return resp.outputFunction(part);
                    }
                }
            }
        }
    }
    return null;
};

module.exports = (clients) => {
    rtm.on('message', async (message) => {
        const {text} = message;
        if(!text)return;
        const resp = responce(text);
        if(!resp)return;
        await slack.chat.postMessage({
            channel: message.channel,
            text: resp,
        });
    });
}
