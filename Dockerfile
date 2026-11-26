FROM node:20-alpine AS builder

WORKDIR /build

COPY package*.json tsconfig.json ./
RUN npm ci --no-audit --no-fund

COPY src ./src
RUN npm run build

FROM node:20-alpine AS runtime

WORKDIR /app

# Grant non-root node binary permission to bind port 80 cleanly on any container runtime
RUN apk add --no-cache libcap && setcap 'cap_net_bind_service=+ep' /usr/local/bin/node

COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund && npm cache clean --force

COPY --from=builder /build/dist ./dist
COPY assets ./assets
COPY configs ./configs
COPY README.md index.html guide.html health.html privacy.html terms.html mcp_explorer.html simulator.html ./

RUN chown -R node:node /app
USER node

ENV NODE_ENV=production
ENV PORT=80
EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 CMD wget -qO- http://127.0.0.1:80/health || exit 1

CMD ["node", "dist/http.js"]
