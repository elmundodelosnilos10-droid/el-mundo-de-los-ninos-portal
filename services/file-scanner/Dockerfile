FROM node:22-alpine3.23@sha256:baf676f7d0e552f3231945c2f979055ca121bce128c152f7a34e6bd1728b1c5a
WORKDIR /app
COPY --chown=node:node clamd.mjs server.mjs healthcheck.mjs ./
USER node
EXPOSE 8080
CMD ["node", "server.mjs"]
