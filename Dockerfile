FROM node:alpine3.20

WORKDIR /app

COPY package.json ./

RUN npm install --production && \
    apk add --no-cache openssl curl gcompat iproute2 coreutils bash

COPY app.js ./
COPY public ./public
COPY data ./data

CMD ["node", "app.js"]
