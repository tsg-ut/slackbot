/* eslint-disable no-undef */
import {countBy} from 'lodash';
import achievements from './achievements';

describe('achievements', () => {
	it('all ids are unique', () => {
		const ids = new Set(Array.from(achievements.values()).map(({id}) => id));
		expect(Array.from(achievements)).toHaveLength(ids.size);
	});

	it('all titles are unique', () => {
		const titles = new Set(Array.from(achievements.values()).map(({title}) => title));
		expect(Array.from(achievements)).toHaveLength(titles.size);
	});

	it('no isolated counter exists', () => {
		const counters = countBy(Array.from(achievements.values()).map(({counter}) => counter));
		for (const count of Object.values(counters)) {
			expect(count).toBeGreaterThan(1);
		}
	});

	it('no isolated category exists', () => {
		const categories = countBy(Array.from(achievements.values()).map(({category}) => category));
		for (const count of Object.values(categories)) {
			expect(count).toBeGreaterThan(1);
		}
	});

	it('value is defined if counter is defined', () => {
		for (const achievement of achievements.values()) {
			if (achievement.counter !== undefined) {
				expect(achievement.value).toBeTruthy();
			}
		}
	});
});
