"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ReadOnlyState = exports.ReadOnlyStateProduction = void 0;
const firestore_1 = __importDefault(require("./firestore"));
const state_1 = require("./state");
const ReadOnlyStateProduction = class ReadOnlyStateProduction {
    name;
    stateObject;
    new;
    static async init(name, defaultValues) {
        const docRef = firestore_1.default.collection('states').doc(name);
        const stateObject = await firestore_1.default.runTransaction(async (transaction) => {
            const doc = await transaction.get(docRef);
            const newState = {
                ...defaultValues,
                ...(doc?.data() || {}),
            };
            transaction.set(docRef, newState);
            return newState;
        });
        const state = new ReadOnlyStateProduction(name, stateObject);
        docRef.onSnapshot(state.onSnapshot.bind(state));
        return stateObject;
    }
    constructor(name, stateObject) {
        this.name = name;
        this.stateObject = stateObject;
    }
    onSnapshot(snapshot) {
        const data = snapshot.data();
        Object.assign(this.stateObject, data);
    }
};
exports.ReadOnlyStateProduction = ReadOnlyStateProduction;
/**
 * 読み取り専用の{@link State}クラス。
 *
 * {@link State}と同じインターフェイスを実装しているが、変更はできず、読み取り専用です。
 * DBへの変更はFirestore→ローカルへの一方向にのみ反映され、変更が検出されたら即座にローカルのオブジェクトが変更されます。
 *
 * ```typescript
 * import {ReadOnlyState} from '../lib/state.ts';
 *
 * interface TestState {
 *   a: string,
 *   b: {c: string, d: number[]}[],
 * }
 *
 * const state = await ReadOnlyState.init<TestState>('test', {a: 'hoge', b: [{c: 'fuga', d: []}]});
 *
 * state.a = 'fuga'; // Error: Cannot assign to 'a' because it is a read-only property.
 *
 * // 変更が追跡されるのはstateオブジェクトのルートからアクセスした場合のみです。
 * // 参照を保持した場合そのプロパティに対するDBへの変更はローカルに反映されません。
 * const b1 = state.b[1];
 * console.log(b1.c); // .b[1].cがFirestore上で変更されても反映されない
 * console.log(state.b[1].c); // .b[1].cがFirestore上で変更されたら反映される
 * ```
 */
exports.ReadOnlyState = process.env.NODE_ENV === 'production' ? exports.ReadOnlyStateProduction : state_1.StateDevelopment;
