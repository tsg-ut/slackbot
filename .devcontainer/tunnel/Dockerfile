FROM mcr.microsoft.com/devcontainers/javascript-node:20
ARG HTTP_PROXY_TOKEN

RUN apt-get update -y && \
    git clone https://${HTTP_PROXY_TOKEN}@github.com/tsg-ut/http-local-fwd.git && \
    cd http-local-fwd/local && \
    npm install

WORKDIR /http-local-fwd/local
