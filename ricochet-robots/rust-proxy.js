'use strict';
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.get_data = void 0;
const child_process_1 = __importDefault(require("child_process"));
const concat_stream_1 = __importDefault(require("concat-stream"));
const path_1 = __importDefault(require("path"));
const get_data = async (boardspec) => {
    const generator = child_process_1.default.spawn(path_1.default.join(__dirname, '../target/release/ricochet_robot_problem_generator'), [`${boardspec.depth}`, `${boardspec.size.h}`, `${boardspec.size.w}`, `${boardspec.numOfWalls}`]);
    const output = await new Promise((resolve) => {
        const stream = (0, concat_stream_1.default)({ encoding: 'buffer' }, (data) => {
            resolve(data);
        });
        generator.stdout.pipe(stream);
    });
    return output.toString();
};
exports.get_data = get_data;
