# Contributing to Aura Courier MCP

Thank you for your interest in contributing to **Aura Courier MCP** — the Universal Bangladesh Courier & Spatial Intelligence Model Context Protocol (MCP) Server.

## Development Workflow

1. **Install Dependencies**:
   ```bash
   npm install
   ```
2. **Build TypeScript**:
   ```bash
   npm run build
   ```
3. **Run Structural & TDQS Validation**:
   ```bash
   node validate_plugin.js
   ```

## Engineering Mandates

- **Zero Mock Data**: Never introduce hardcoded fallback metrics or fabricated carrier responses. All tools must query live carrier APIs or return transparent operational status codes.
- **Bilingual Support (`🇧🇩 বাংলা | 🇬🇧 English`)**: User-facing recommendations and guides must support both Bengali and English.
- **Zero Hardcoded Secrets**: Never commit API keys, tokens, or merchant credentials.
