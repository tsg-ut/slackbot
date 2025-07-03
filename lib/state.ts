import {throttle, groupBy} from 'lodash';
import db from './firestore.js';
import {Deferred} from './utils.js';
import path from 'path';
import {inspect} from 'util';
import fs from 'fs-extra';
import schedule from 'node-schedule';
import {Mutex} from 'async-mutex';
import {observable, toJS} from 'mobx';
import type {IObjectDidChange, IArrayDidChange, IMapDidChange} from 'mobx';
import {deepObserve} from 'mobx-utils';
import logger from './logger.js';
import {fileURLToPath} from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

declare type IChange = IObjectDidChange | IArrayDidChange | IMapDidChange;

const statesDeferred = new Deferred<FirebaseFirestore.QuerySnapshot<FirebaseFirestore.DocumentData>>();
(async () => {
	if (process.env.NODE_ENV === 'production') {
		statesDeferred.resolve(await db.collection('states').get());
	}
})();

const usageCount = new Map<string, number>();

export const updateUsageCount = (key: string) => {
	usageCount.set(key, (usageCount.get(key) ?? 0) + 1);
};

const recordUsage = (name: string, operation: string) => {
	updateUsageCount(`state_${name}_${operation}`);
};

schedule.scheduleJob('0 * * * *', (date) => {
	logger.info(`Firestore usage at ${date}: ${inspect(usageCount)}`);
	usageCount.clear();
});

const updatedProperties: {name: string, property: string, value: any}[] = [];

const updateDb = (name: string, property: string, value: any) => {
	updatedProperties.push({name, property, value});
	triggerUpdateDb();
};

const triggerUpdateDb = throttle(async () => {
	const propertyChanges = updatedProperties.splice(0);
	const states = groupBy(propertyChanges, (prop) => prop.name);
	await db.runTransaction(async (transaction) => {
		const stateData = new Map<string, boolean>();
		await Promise.all(Object.keys(states).map(async (state) => {
			const stateRef = db.collection('states').doc(state);
			const stateTransaction = await transaction.get(stateRef);
			recordUsage(state, 'get');
			stateData.set(state, stateTransaction.exists);
		}));
		for (const [stateName, stateUpdates] of Object.entries(states)) {
			const stateRef = db.collection('states').doc(stateName);
			const exists = stateData.get(stateName);
			const newValues = new Map<string, any>();
			for (const {property, value} of stateUpdates) {
				newValues.set(property, value);
			}
			if (exists) {
				transaction.update(stateRef, Object.fromEntries(newValues));
				recordUsage(stateName, 'update');
			} else {
				transaction.set(stateRef, Object.fromEntries(newValues));
				recordUsage(stateName, 'set');
			}
		}
	});
}, 30 * 1000);

export interface StateInterface {
	init<StateObj>(name: string, defaultValues: StateObj): Promise<StateObj>,
}

export const StateProduction: StateInterface = class StateProduction<StateObj> {
	name: string;
	stateObject: {[key: string]: any};
	new: (name: string, defaultValues: StateObj) => Partial<StateObj>;

	static async init<StateObj>(name: string, defaultValues: StateObj): Promise<StateObj> {
		const statesData = await statesDeferred.promise;
		const stateDoc = statesData.docs.find((doc) => doc.id === name);

		const initialState = {
			...defaultValues,
			...(stateDoc?.data() || {}),
		};

		const stateObject = observable(initialState);

		const state = new StateProduction<StateObj>(name, stateObject);
		deepObserve(stateObject, state.onUpdate.bind(state));

		return stateObject;
	}

	constructor(name: string, initialValues: StateObj) {
		this.name = name;
		this.stateObject = initialValues;
	}

	private onUpdate(change: IChange, path: string, root: StateObj) {
		const properties = path.length > 0 ? path.split('/') : [];
		if (change.observableKind !== 'array') {
			properties.push(change.name);
		}
		if (properties.length >= 1 && this.stateObject.hasOwnProperty(properties[0])) {
			updateDb(this.name, properties[0], this.stateObject[properties[0]]);
		}
	}
}

export const StateDevelopment: StateInterface = class StateDevelopment<StateObj> {
	name: string;
	statePath: string;
	stateObject: {[key: string]: any};
	mutex: Mutex;
	new: (name: string, defaultValues: StateObj) => Partial<StateObj>;

	static async init<StateObj>(name: string, defaultValues: StateObj): Promise<StateObj> {
		await fs.mkdirp(path.resolve(__dirname, '__state__'));
		const statePath = path.resolve(__dirname, '__state__', `${name}.json`);

		let stateObj = {};
		if (await fs.pathExists(statePath)) {
			const data = await fs.readFile(statePath);
			stateObj = JSON.parse(data.toString());
		} else {
			await fs.writeFile(statePath, JSON.stringify(defaultValues, null, '  '));
		}

		const initialState = {
			...defaultValues,
			...stateObj,
			[inspect.custom]: function() { return toJS(this); },
		};

		const stateObject = observable(initialState);

		const state = new StateDevelopment<StateObj>(name, stateObject);
		deepObserve(stateObject, state.onUpdate.bind(state));

		return stateObject;
	}

	constructor(name: string, initialValues: StateObj) {
		this.name = name;
		this.stateObject = initialValues;
		this.statePath = path.resolve(__dirname, '__state__', `${name}.json`);
		this.mutex = new Mutex();
	}

	private onUpdate() {
		const data = JSON.stringify(this.stateObject, null, '  ');
		return this.mutex.runExclusive(async () => {
			await fs.writeFile(this.statePath, data);
		});
	}
}

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
const State: StateInterface = process.env.NODE_ENV === 'production' ? StateProduction : StateDevelopment;

export default State;

export {ReadOnlyState} from './readOnlyState';
