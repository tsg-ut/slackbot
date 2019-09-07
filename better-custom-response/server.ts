import {FastifyInstance} from 'fastify';
import {CustomResponse} from './custom-responses';
import {WebClient, RTMClient, MessageAttachment} from '@slack/client';

interface TextBoxContent {
    id: string,
    text: string,
}

interface WebCustomResponse {
    id: string,
    inputs: TextBoxContent[],
    outputs: TextBoxContent[],
}

const customResponses= new Map<string, WebCustomResponse>();

export const server = ({webClient: slack}: {webClient: WebClient}) => async (fastify: FastifyInstance) => {
    fastify.post('/bcr/update', async (req, res) => {
        const {id, inputs, outputs}: {id: string, inputs: any[], outputs: any[]} = req.body;
        const response: WebCustomResponse = {id, inputs, outputs};
        customResponses.set(id, response);
        return ({ok: true});
    });

    fastify.get('/bcr/list', async (req, res) => {
        return Array.from(customResponses.values());
    })
}


export const getCustomResponses = () => 
    Array.from(customResponses.values()).map(({inputs, outputs}) => ({
        input: inputs.map(({text}) => new RegExp(text)),
        outputArray: outputs.map(({text}) => text),
    }))
