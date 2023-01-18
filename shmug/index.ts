import axios from 'axios';
import plugin from 'fastify-plugin';
/* eslint-disable no-unused-vars */
import type { SlackInterface, SlashCommandEndpoint } from '../lib/slack';
import { getMemberName, getMemberIcon } from '../lib/slackUtils';

export const server = ({ eventClient, webClient: slack }: SlackInterface) =>
  plugin(async (fastify) => {
    const { team: tsgTeam }: any = await slack.team.info();
    fastify.post<SlashCommandEndpoint>(
      '/slash/shmug',
      async (request, response) => {
        if (request.body.token !== process.env.SLACK_VERIFICATION_TOKEN) {
          response.code(400);
          return 'Bad Request';
        }
        if (request.body.team_id !== tsgTeam.id) {
          response.code(200);
          return '/shmug is only for TSG. Sorry!';
        }
        const username = await getMemberName(request.body.user_id);
        const icon_url = await getMemberIcon(request.body.user_id, 512);
        slack.chat.postMessage({
          username,
          icon_url,
          channel: request.body.channel_id,
          text: request.body.text + ' c|_|',
        });
        return '';
      }
    );
  });
