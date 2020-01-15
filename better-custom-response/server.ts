import {FastifyInstance} from 'fastify';
import {CustomResponse} from './custom-responses';
import {WebClient, RTMClient, MessageAttachment} from '@slack/client';
import safe from 'safe-regex';
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

const checkInput = (input: TextBoxContent): string => {
    // safe-regexは完全ではないので，ReDoS対策としては十分ではない
    // あくまで悪意のないユーザーが誤って病的なRegexpを投げるのを防ぐのが目的
    if (typeof(input.id) !== 'string' || input.id.length !== 26) {
        return 'invalid id';
    }
    if (typeof(input.text) !== 'string') {
        return 'invalid input';
    }
    try {
        new RegExp(input.text);
    } catch(e) {
        return 'input is invalid as regexp';
    }
    if (!safe(input.text)) {
        return 'this regexp is not allowed';
    }
    return null;
}

export const server = ({webClient: slack}: {webClient: WebClient}) => async (fastify: FastifyInstance) => {
    fastify.post('/bcr/update', async (req, res) => {
        const {id, inputs, outputs}: {id: string, inputs: any[], outputs: any[]} = req.body;
        const error: {inputs:any, outputs:any} = {inputs: {}, outputs: {}};
        if (inputs.length > 0) {
            // TODO
        }
        const response: WebCustomResponse = {id, inputs, outputs};
        customResponses.set(id, response);
        saveResponses();
        return ({ok: true});
    });

    fastify.post('/bcr/delete', async (req, res) => {
        const {id}: {id: string} = req.body;
        const idExisted = customResponses.delete(id);
        if (!idExisted) {
            // TODO: Error
        }
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
