FROM node:20-bookworm
ARG HTTP_PROXY_TOKEN

RUN apt-get update -y && \
    apt-get install git bash -y && \
    git clone https://${HTTP_PROXY_TOKEN}@github.com/tsg-ut/http-local-fwd.git && \
    cd http-local-fwd/local && \
    npm install

WORKDIR /http-local-fwd/local
