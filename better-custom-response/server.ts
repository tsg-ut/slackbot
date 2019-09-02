import {FastifyInstance} from 'fastify';
import {CustomResponse} from './custom-responses';
import {WebClient, RTMClient, MessageAttachment} from '@slack/client';

export const server = ({webClient: slack}: {webClient: WebClient}) => async (fastify: FastifyInstance) => {
    fastify.post('/bcr/update', async (req, res) => {
        if(customResponses.length)customResponses.pop();
        const response: CustomResponse = {
            input: [new RegExp(req.body.input)],
            outputArray: [req.body.output],
        }
        customResponses.push(response);
        return ({ok: true});
    });
}

export const customResponses: CustomResponse[] = [];
