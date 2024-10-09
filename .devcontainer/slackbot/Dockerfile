FROM node:20-bookworm

# Install build dependencies for node-canvas
# https://github.com/Automattic/node-canvas/wiki/Installation%3A-Ubuntu-and-other-Debian-based-systems
RUN apt-get update -y && \
    apt-get install build-essential libcairo2-dev libpango1.0-dev libjpeg-dev libgif-dev librsvg2-dev -y && \
    apt-get install git bash -y && \
    mkdir -p ~/.cache/slackbot/node_modules && \
    mkdir -p ~/.cache/slackbot-functions/node_modules && \
    git clone https://github.com/tsg-ut/slackbot.git --branch master --single-branch --recursive --depth 1 /code && \
    cd /code && \
    npm install && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /code