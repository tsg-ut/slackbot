"use strict";
/* eslint-env node, jest */
Object.defineProperty(exports, "__esModule", { value: true });
const render = jest.fn(() => (Promise.resolve(Buffer.alloc(0x100))));
exports.default = render;
