FROM node:20-alpine

WORKDIR /app

# Install deps (incl. dev deps for the TypeScript build)
COPY package*.json tsconfig.json ./
RUN npm install --no-audit --no-fund

# Source + web, static assets and simulator
COPY src ./src
COPY assets ./assets
COPY configs ./configs
COPY README.md index.html guide.html health.html privacy.html terms.html mcp_explorer.html simulator.html ./
RUN npm run build

ENV NODE_ENV=production
# Listen on 80 so it matches the existing app/proxy port (no label change needed)
ENV PORT=80
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 CMD wget -qO- http://127.0.0.1:80/health || exit 1

# Remote HTTP MCP endpoint: GET / = landing, POST /mcp = MCP.
# The npm/npx build stays STDIO (dist/index.js, unchanged).
CMD ["node", "dist/http.js"]
