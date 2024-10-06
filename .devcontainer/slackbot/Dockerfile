FROM node:20-bookworm

# Install build dependencies for node-canvas
# https://github.com/Automattic/node-canvas/wiki/Installation%3A-Ubuntu-and-other-Debian-based-systems
RUN apt-get update -y && \
    apt-get install build-essential libcairo2-dev libpango1.0-dev libjpeg-dev libgif-dev librsvg2-dev -y && \
    apt-get install git bash && \
    mkdir -p /code/functions && \
    mkdir -p ~/.cache/slackbot/node_modules && \
    mkdir -p ~/.cache/slackbot-functions/node_modules && \
    cd /code && \
    ln -s ~/.cache/slackbot/node_modules node_modules && \
    ln -s ~/.cache/slackbot-functions/node_modules functions/node_modules && \
    wget https://github.com/tsg-ut/slackbot/raw/refs/heads/master/package.json && \
    wget https://github.com/tsg-ut/slackbot/raw/refs/heads/master/package-lock.json && \
    wget https://github.com/tsg-ut/slackbot/raw/refs/heads/master/functions/package.json -O functions/package.json && \
    wget https://github.com/tsg-ut/slackbot/raw/refs/heads/master/functions/package-lock.json -O functions/package-lock.json && \
    npm install --ignore-scripts && \
    npm install --ignore-scripts --prefix functions && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /code