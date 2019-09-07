import {FastifyInstance} from 'fastify';
import {CustomResponse} from './custom-responses';
import {WebClient, RTMClient, MessageAttachment} from '@slack/client';

const customResponses: CustomResponse[] = [];

export const server = ({webClient: slack}: {webClient: WebClient}) => async (fastify: FastifyInstance) => {
    fastify.post('/bcr/update', async (req, res) => {
        if(customResponses.length)customResponses.pop();
        const response: CustomResponse = {
            input: req.body.inputs.map(({text}: {text: string}) => new RegExp(text)),
            outputArray: req.body.outputs.map(({text}: {text: string}) => text),
        }
        customResponses.push(response);
        return ({ok: true});
    });
}


export const getCustomResponses = () => customResponses;