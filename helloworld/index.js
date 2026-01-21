"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const HelloWorld_1 = require("./HelloWorld");
exports.default = async (slackInterface) => {
    const helloworld = await HelloWorld_1.HelloWorld.create(slackInterface);
    helloworld.postHelloWorld();
};
