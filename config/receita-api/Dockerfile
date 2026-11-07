FROM node:22-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --ignore-scripts
COPY server.mjs query.mjs ./
USER node
EXPOSE 3000
CMD ["node", "server.mjs"]
