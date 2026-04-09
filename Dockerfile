FROM node:22-slim
WORKDIR /app
COPY package.json .
RUN npm install --production
COPY server.js .
EXPOSE 7799
ENV PORT=7799
CMD ["node", "server.js"]
