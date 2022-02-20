import type EventEmitter from 'events';

export interface TSGEventClient {
	emit(event: string, ...args: any[]): boolean;
	on(event: string, listener: (...args: any[]) => void): any;
	onAllTeam(event: string, listener: (...args: any[]) => void): any;
	// feel free to add any EventEmitter properties if you want to use!
};

export const createTSGEventClient = (team: string, eventClient: EventEmitter): TSGEventClient => {
	return {
		onAllTeam(event: string, listener: (...args: any[]) => void) {
			return eventClient.on(event, listener);
		},
		on(event: string, listener: (...args: any[]) => void) {
			return eventClient.on(event, (...args) => {
				if (args[0]?.team_id === team) {
					listener(...args);
				}
			});
		},
		...eventClient,
	};
};
