import plugin from 'fastify-plugin';
import { fastifyDevConstructor } from './fastify';
import { FastifyInstance } from 'fastify';

describe('fastifyDevConstructor', () => {
    it('throws error when error occures during request', () => {
        const fastify: FastifyInstance = fastifyDevConstructor();
        const msg = 'Dummy error.';
        const path = '/path/to/somewhere';
        fastify.register(plugin((fastify, opts, next) => {
            fastify.get(path, (req) => {
                throw Error(msg);
            })
            next();
        }))
        expect(
            fastify.inject({
                method: 'GET',
                url: path,
                payload: {something: 'hoge'},
            })
        ).rejects.toThrow(msg);
    })
});
