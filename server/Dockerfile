FROM node:24-alpine
WORKDIR /app
# Build context is the project root (see railway.json dockerfilePath).
COPY server/package.json ./
RUN npm install --omit=dev
COPY server/src ./src
COPY data ./data
COPY public ./public
ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "src/server.js"]