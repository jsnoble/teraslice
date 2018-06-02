FROM node:8
MAINTAINER Kimbro Staken

RUN mkdir -p /app/source
WORKDIR /app/source
COPY package.json /app/source

RUN npm set progress=false && npm config set depth 0
RUN npm install bunyan
RUN npm install --only=production

COPY . /app/source

EXPOSE 5678

VOLUME /app/config /app/logs

ENTRYPOINT ["node", "service.js"]
