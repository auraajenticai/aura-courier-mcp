# Aura Courier MCP — Agent Configurations Vault

Connect any AI Agent / IDE to Aura Courier MCP in seconds.

## Endpoints:
- **Streamable-HTTP (Cursor, Antigravity, Windsurf, Cline, n8n)**:
  `https://courier.auraajenticai.cloud/mcp`
- **Server-Sent Events / SSE (Claude Desktop, Remote SSE)**:
  `https://courier.auraajenticai.cloud/sse`
- **NPX Direct CLI**:
  `npx -y aura-courier-mcp@2.6.1`

---

## 1. Google Antigravity & Gemini CLI
File: `antigravity_gemini.json`
Location:
- Windows: `%USERPROFILE%\.gemini\antigravity\mcp\aura-courier\server.json`
- Linux/macOS: `~/.gemini/antigravity/mcp/aura-courier/server.json`

## 2. Claude Desktop
File: `claude_desktop_config.json`
Location:
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`
- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`

## 3. Cursor IDE
File: `cursor_mcp.json`
Location:
- Settings -> Features -> MCP -> Add new MCP server -> Type: `http`, URL: `https://courier.auraajenticai.cloud/mcp`

## 4. Windsurf IDE
File: `windsurf_mcp_config.json`
Location:
- `~/.codeium/windsurf/mcp_config.json`

## 5. Cline / Roo Code / VS Code
File: `cline_mcp_settings.json`
Location:
- VS Code Settings -> Extension Settings -> Cline / Roo Code -> Edit in settings.json
