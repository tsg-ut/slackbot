import {FastifyInstance} from 'fastify';
import {CustomResponse} from './custom-responses';
import {WebClient, RTMClient, MessageAttachment} from '@slack/client';

const customResponses= new Map<string, CustomResponse>();

export const server = ({webClient: slack}: {webClient: WebClient}) => async (fastify: FastifyInstance) => {
    fastify.post('/bcr/update', async (req, res) => {
        const {id, inputs, outputs}: {id: string, inputs: any[], outputs: any[]} = req.body;
        const response: CustomResponse = {
            input: inputs.map(({text}: {text: string}) => new RegExp(text)),
            outputArray: outputs.map(({text}: {text: string}) => text),
        }
        customResponses.set(id, response);
        return ({ok: true});
    });
}


export const getCustomResponses = () => customResponses.values();