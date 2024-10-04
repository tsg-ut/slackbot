FROM node:20-alpine

# Install build dependencies for node-canvas
# https://github.com/Automattic/node-canvas/issues/2239#issuecomment-2005970772
RUN apk update && apk add build-base g++ cairo-dev pango-dev giflib-dev && \
    apt add git bash

WORKDIR /code