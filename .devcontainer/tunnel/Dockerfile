FROM node:20-alpine
ARG HTTP_PROXY_TOKEN

RUN apk update && \
    apk add git bash && \
    git clone https://${HTTP_PROXY_TOKEN}@github.com/tsg-ut/http-local-fwd.git && \
    cd http-local-fwd/local && \
    npm install

WORKDIR /http-local-fwd/local
