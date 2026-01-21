"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ReadOnlyState = exports.StateDevelopment = exports.StateProduction = exports.updateUsageCount = void 0;
const lodash_1 = require("lodash");
const firestore_1 = __importDefault(require("./firestore"));
const utils_1 = require("./utils");
const path_1 = __importDefault(require("path"));
const util_1 = require("util");
const fs_extra_1 = __importDefault(require("fs-extra"));
const node_schedule_1 = __importDefault(require("node-schedule"));
const async_mutex_1 = require("async-mutex");
const mobx_1 = require("mobx");
const mobx_utils_1 = require("mobx-utils");
const logger_1 = __importDefault(require("./logger"));
const statesDeferred = new utils_1.Deferred();
(async () => {
    if (process.env.NODE_ENV === 'production') {
        statesDeferred.resolve(await firestore_1.default.collection('states').get());
    }
})();
const usageCount = new Map();
const updateUsageCount = (key) => {
    usageCount.set(key, (usageCount.get(key) ?? 0) + 1);
};
exports.updateUsageCount = updateUsageCount;
const recordUsage = (name, operation) => {
    (0, exports.updateUsageCount)(`state_${name}_${operation}`);
};
node_schedule_1.default.scheduleJob('0 * * * *', (date) => {
    logger_1.default.info(`Firestore usage at ${date}: ${(0, util_1.inspect)(usageCount)}`);
    usageCount.clear();
});
const updatedProperties = [];
const updateDb = (name, property, value) => {
    updatedProperties.push({ name, property, value });
    triggerUpdateDb();
};
const triggerUpdateDb = (0, lodash_1.throttle)(async () => {
    const propertyChanges = updatedProperties.splice(0);
    const states = (0, lodash_1.groupBy)(propertyChanges, (prop) => prop.name);
    await firestore_1.default.runTransaction(async (transaction) => {
        const stateData = new Map();
        await Promise.all(Object.keys(states).map(async (state) => {
            const stateRef = firestore_1.default.collection('states').doc(state);
            const stateTransaction = await transaction.get(stateRef);
            recordUsage(state, 'get');
            stateData.set(state, stateTransaction.exists);
        }));
        for (const [stateName, stateUpdates] of Object.entries(states)) {
            const stateRef = firestore_1.default.collection('states').doc(stateName);
            const exists = stateData.get(stateName);
            const newValues = new Map();
            for (const { property, value } of stateUpdates) {
                newValues.set(property, value);
            }
            if (exists) {
                transaction.update(stateRef, Object.fromEntries(newValues));
                recordUsage(stateName, 'update');
            }
            else {
                transaction.set(stateRef, Object.fromEntries(newValues));
                recordUsage(stateName, 'set');
            }
        }
    });
}, 30 * 1000);
const StateProduction = class StateProduction {
    name;
    stateObject;
    new;
    static async init(name, defaultValues) {
        const statesData = await statesDeferred.promise;
        const stateDoc = statesData.docs.find((doc) => doc.id === name);
        const initialState = {
            ...defaultValues,
            ...(stateDoc?.data() || {}),
        };
        const stateObject = (0, mobx_1.observable)(initialState);
        const state = new StateProduction(name, stateObject);
        (0, mobx_utils_1.deepObserve)(stateObject, state.onUpdate.bind(state));
        return stateObject;
    }
    constructor(name, initialValues) {
        this.name = name;
        this.stateObject = initialValues;
    }
    onUpdate(change, path, root) {
        const properties = path.length > 0 ? path.split('/') : [];
        if (change.observableKind !== 'array') {
            properties.push(change.name);
        }
        if (properties.length >= 1 && this.stateObject.hasOwnProperty(properties[0])) {
            updateDb(this.name, properties[0], this.stateObject[properties[0]]);
        }
    }
};
exports.StateProduction = StateProduction;
const StateDevelopment = class StateDevelopment {
    name;
    statePath;
    stateObject;
    mutex;
    new;
    static async init(name, defaultValues) {
        await fs_extra_1.default.mkdirp(path_1.default.resolve(__dirname, '__state__'));
        const statePath = path_1.default.resolve(__dirname, '__state__', `${name}.json`);
        let stateObj = {};
        if (await fs_extra_1.default.pathExists(statePath)) {
            const data = await fs_extra_1.default.readFile(statePath);
            stateObj = JSON.parse(data.toString());
        }
        else {
            await fs_extra_1.default.writeFile(statePath, JSON.stringify(defaultValues, null, '  '));
        }
        const initialState = {
            ...defaultValues,
            ...stateObj,
            [util_1.inspect.custom]: function () { return (0, mobx_1.toJS)(this); },
        };
        const stateObject = (0, mobx_1.observable)(initialState);
        const state = new StateDevelopment(name, stateObject);
        (0, mobx_utils_1.deepObserve)(stateObject, state.onUpdate.bind(state));
        return stateObject;
    }
    constructor(name, initialValues) {
        this.name = name;
        this.stateObject = initialValues;
        this.statePath = path_1.default.resolve(__dirname, '__state__', `${name}.json`);
        this.mutex = new async_mutex_1.Mutex();
    }
    onUpdate() {
        const data = JSON.stringify(this.stateObject, null, '  ');
        return this.mutex.runExclusive(async () => {
            await fs_extra_1.default.writeFile(this.statePath, data);
        });
    }
};
exports.StateDevelopment = StateDevelopment;
/**
 * State: Slackbotが再起動しても蒸発しないステートデータを保存するためのクラスです。
 * production環境ではFirestore, development環境ではローカルのJSONファイルを用いてデータを保存します。
 *
 * get, set, increment の3つのデータ更新用メソッドはすべて同期的に動作し、ローカルのキャッシュが即座に更新されるようになっています。
 * production環境では30秒に1回データベースがアップデートされます。
 * 内部実装にはMobxを用いているため、ネストされたプロパティへのアクセスもすべて追跡されます。
 *
 * 実装の簡素化のため、インクリメントや配列へのプッシュなどはアトミックに実装されていません。
 * 本番環境でも開発環境でもバックエンドのデータベースは複数箇所から書き込まれることがないのでこれは通常問題になりませんが、
 * デプロイの際は複数箇所で同じ種類のBOTを起動することがないように注意してください。
 *
 * ```typescript
 * import State from '../lib/state.ts';
 *
 * interface TestState {
 *   a: string,
 *   b: {c: string, d: number[]}[],
 * }
 *
 * const state = await State.init<TestState>('test', {a: 'hoge', b: [{c: 'fuga', d: []}]});
 *
 * // 例えば以下のような変更は自動的に保存されます。
 * state.a = 'fuga';
 * state.b[0].c += 'fuganyan';
 * const b = state.b.find(() => true);
 * b.d.push(100);
 *
 * // 古くなった参照への変更は保存されません。
 * const b2 = state.b[0];
 * state.b[0] = {c: 'nyan', d: [0]};
 * b2.c = 'hoge'; // 保存されない
 * ```
 */
const State = process.env.NODE_ENV === 'production' ? exports.StateProduction : exports.StateDevelopment;
exports.default = State;
var readOnlyState_1 = require("./readOnlyState");
Object.defineProperty(exports, "ReadOnlyState", { enumerable: true, get: function () { return readOnlyState_1.ReadOnlyState; } });
