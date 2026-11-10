FROM mcr.microsoft.com/playwright:v1.64.1-noble
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY backend ./backend
USER pwuser
ENV NODE_ENV=production
CMD ["node", "backend/server.mjs"]
