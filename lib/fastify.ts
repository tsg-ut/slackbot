import fastifyConstructor, { FastifyInstance } from 'fastify';

/**
 * 単体テストに適した設定がなされたfastifyインスタンスを生成する
 * 
 * @param opts fastifyConstructor に渡す引数
 * @example
 * import slack from '../lib/slackMock.js';
 * import {fastifyDevConstructor} from '../lib/fastify';
 * import {server} from './index';
 * 
 * const fastify = fastifyDevConstructor();
 * fastify.register(server(slack));
 */

export const fastifyDevConstructor = (opts?: Parameters<typeof fastifyConstructor>[0]): FastifyInstance => {
    // TODO: support generics of fastifyConstructor
    /*
     * Setting the return type to ReturnType<fastifyConstructor> causes typeerror
     * because type Server is not compatible with type Http2SecureServer
     * Maybe because of not handling the generics of fastifyConstructor
     */

    const fastify = fastifyConstructor({ logger: true , ...opts });

    /**
     * デフォルトのエラーハンドラはエラーをログに出力して握り潰すため，
     * 単体テストでexpectの失敗などによる例外をJestが検知することができない
     * 発生した例外は全て再送出するように設定
     */
    fastify.setErrorHandler((err) => { throw err; });

    return fastify;
};
