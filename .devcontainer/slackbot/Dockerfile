FROM node:20-bookworm

RUN apt-get update -y && \
    # Install build dependencies for node-canvas
    # https://github.com/Automattic/node-canvas/wiki/Installation%3A-Ubuntu-and-other-Debian-based-systems
    apt-get install build-essential libcairo2-dev libpango1.0-dev libjpeg-dev libgif-dev librsvg2-dev -y && \
    # Install git and bash
    apt-get install git bash -y && \
    # Install ngrok
    curl -sSL https://ngrok-agent.s3.amazonaws.com/ngrok.asc | tee /etc/apt/trusted.gpg.d/ngrok.asc > /dev/null && \
    echo "deb https://ngrok-agent.s3.amazonaws.com buster main" | tee /etc/apt/sources.list.d/ngrok.list && \
    apt-get update && \
    apt-get install ngrok -y && \
    # Install slackbot npm dependencies
    mkdir -p ~/.cache/slackbot/node_modules && \
    mkdir -p ~/.cache/slackbot-functions/node_modules && \
    git clone https://github.com/tsg-ut/slackbot.git --branch master --single-branch --recursive --depth 1 /code && \
    cd /code && \
    npm install && \
    # Cleanup
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /code