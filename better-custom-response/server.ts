import {FastifyInstance} from 'fastify';
import {CustomResponse} from './custom-responses';
import {WebClient, RTMClient, MessageAttachment} from '@slack/client';
import {promisify} from 'util';
import {writeFile} from 'fs';
import path from 'path';

interface TextBoxContent {
    id: string,
    text: string,
}

interface WebCustomResponse {
    id: string,
    inputs: TextBoxContent[],
    outputs: TextBoxContent[],
}

const savedResponsesPath = 'web-custom-responses.json';

const customResponses: Map<string, WebCustomResponse> = (() => {
    try {
        const savedResponses: WebCustomResponse[] = require(`./${savedResponsesPath}`);
        return new Map(savedResponses.map(r => [r.id, r]));
    } catch (e) {
        if(e.code === 'MODULE_NOT_FOUND') {
            return new Map<string, WebCustomResponse>();
        }
        throw e;
    }
})();

const saveResponses = async () => {
    await promisify(writeFile)(
        path.join(__dirname, savedResponsesPath),
        JSON.stringify(Array.from(customResponses.values())),
    );
}

export const server = ({webClient: slack}: {webClient: WebClient}) => async (fastify: FastifyInstance) => {
    fastify.post('/bcr/update', async (req, res) => {
        const {id, inputs, outputs}: {id: string, inputs: any[], outputs: any[]} = req.body;
        const response: WebCustomResponse = {id, inputs, outputs};
        customResponses.set(id, response);
        saveResponses();
        return ({ok: true});
    });

    fastify.get('/bcr/list', async (req, res) => {
        return Array.from(customResponses.values()).sort(({id: id1}, {id: id2}) => id1 > id2? 1:-1);
    })
}


export const getCustomResponses = (): CustomResponse[] => 
    Array.from(customResponses.values()).map(({inputs, outputs}) => ({
        input: inputs.map(({text}) => new RegExp(text)),
        outputArray: outputs.map(({text}) => text),
    }))
