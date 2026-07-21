# Aura Courier MCP — hosted HTTP transport (Streamable HTTP)
FROM node:22-alpine
WORKDIR /app

# Install deps (skip prepare/postinstall build here; we build explicitly below)
COPY package*.json ./
RUN npm ci --ignore-scripts

# Build
COPY . .
RUN npm run build

ENV PORT=8080
EXPOSE 8080
CMD ["node", "dist/http.js"]
