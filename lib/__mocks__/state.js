"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ReadOnlyState = void 0;
const State = class State {
    name;
    stateMap;
    new;
    static mocks = new Map();
    static async init(name, defaultValues) {
        const state = new State(name, defaultValues);
        const keys = new Set(Object.keys(defaultValues));
        const stateObj = new Proxy(state, {
            get(obj, key) {
                return keys.has(key) ? obj.get(key) : Reflect.get(obj, key);
            },
            set(obj, key, value) {
                keys.has(key) ? obj.set(key, value) : Reflect.set(obj, key, value);
                return true;
            }
        });
        State.mocks.set(name, stateObj);
        return stateObj;
    }
    constructor(name, initialValues) {
        this.name = name;
        this.stateMap = new Map(Object.entries(initialValues));
    }
    get(key) {
        return this.stateMap.get(key);
    }
    set(key, value) {
        this.stateMap.set(key, value);
    }
    increment(key, value) {
        this.stateMap.set(key, this.stateMap.get(key) + value);
    }
};
exports.default = State;
exports.ReadOnlyState = State;
