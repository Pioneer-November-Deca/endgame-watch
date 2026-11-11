FROM node:22-bookworm-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY backend ./backend
COPY docs/regions.js docs/alarm-policy.js ./docs/
USER node
ENV NODE_ENV=production
CMD ["node", "backend/server.mjs"]
