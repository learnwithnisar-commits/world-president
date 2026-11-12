FROM node:24-alpine
WORKDIR /app
# Keep the repo layout intact: server code lives at /app/server/src, so the
# app's path.join(__dirname, '..', '..', 'public'|'data') resolves to the
# real /app/public and /app/data. (A flat /app/src layout broke this: it
# resolved to /public and /data, hiding the frontend and the 40-country
# seed and serving the /data volume — including world.db — over HTTP.)
COPY server/package.json server/package-lock.json ./server/
RUN cd server && npm install --omit=dev
COPY server/src ./server/src
COPY data ./data
COPY public ./public
ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "server/src/server.js"]
