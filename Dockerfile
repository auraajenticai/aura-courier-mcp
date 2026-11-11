FROM node:20-alpine

WORKDIR /app

# Install deps (incl. dev deps for the TypeScript build)
COPY package*.json tsconfig.json ./
RUN npm install --no-audit --no-fund

# Source + the marketing landing page (served at /)
COPY src ./src
COPY README.md index.html ./
RUN npm run build

ENV NODE_ENV=production
# Listen on 80 so it matches the existing app/proxy port (no label change needed)
ENV PORT=80
EXPOSE 80

# Remote HTTP MCP endpoint: GET / = landing, POST /mcp = MCP.
# The npm/npx build stays STDIO (dist/index.js, unchanged).
CMD ["node", "dist/http.js"]
