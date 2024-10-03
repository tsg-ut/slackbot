FROM node:20-alpine
ARG GITHUB_TOKEN

RUN apk update && \
    apk add git && \
    git clone https://${GITHUB_TOKEN}@github.com/tsg-ut/http-local-fwd.git && \
    cd http-local-fwd/local && \
    npm install

WORKDIR /http-local-fwd/local
