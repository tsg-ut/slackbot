FROM node:20-bookworm

# Install build dependencies for node-canvas
# https://github.com/Automattic/node-canvas/wiki/Installation%3A-Ubuntu-and-other-Debian-based-systems
RUN apt-get update -y && \
    apt-get install build-essential libcairo2-dev libpango1.0-dev libjpeg-dev libgif-dev librsvg2-dev -y && \
    apt-get install git bash

WORKDIR /code