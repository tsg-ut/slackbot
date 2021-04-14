import type {StateInterface} from '../state';

const State: StateInterface = class State<StateObj> {
	name: string;
	stateMap: Map<string, any>;
	new: (name: string, defaultValues: StateObj) => Partial<StateObj>;

	static async init<StateObj>(name: string, defaultValues: StateObj): Promise<StateObj & State<StateObj>> {
		const state = new State<StateObj>(name, defaultValues);
		const keys = new Set(Object.keys(defaultValues));

		return new Proxy(state, {
			get(obj: any, key: string) {
				return keys.has(key) ? obj.get(key) : Reflect.get(obj, key);
			},
			set(obj: any, key: string, value: any) {
				keys.has(key) ? obj.set(key, value) : Reflect.set(obj, key, value);
				return true;
			}
		});
	}

	constructor(name: string, initialValues: StateObj) {
		this.name = name;
		this.stateMap = new Map(Object.entries(initialValues));
	}

	get(key: keyof StateObj & string) {
		return this.stateMap.get(key);
	}

	set<K extends keyof StateObj & string>(key: K, value: StateObj[K]) {
		this.stateMap.set(key, value);
	}

	increment<K extends keyof StateObj & string>(key: K, value: StateObj[K] & number) {
		this.stateMap.set(key, this.stateMap.get(key) + value);
	}
}

export default State;
