/**
 * Aura Courier MCP — Plugin Validation & Compliance Suite (v2.5.1)
 * Corresponds to `agy plugin validate .` standards.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PLUGIN_DIR = __dirname;
let passedChecks = 0;
let totalChecks = 0;

function assert(condition, message) {
  totalChecks++;
  if (condition) {
    passedChecks++;
    console.log(`  [PASS] ${message}`);
  } else {
    console.error(`  [FAIL] ${message}`);
    process.exitCode = 1;
  }
}

async function validateManifest() {
  console.log('\n--- 1. Validating plugin.json Manifest ---');
  const manifestPath = path.join(PLUGIN_DIR, 'plugin.json');
  assert(fs.existsSync(manifestPath), 'plugin.json exists');

  const content = fs.readFileSync(manifestPath, 'utf8');
  let json;
  try {
    json = JSON.parse(content);
    assert(true, 'plugin.json is valid JSON');
  } catch (err) {
    assert(false, `plugin.json JSON parse error: ${err.message}`);
    return;
  }

  assert(json.name === 'aura-courier', `name matches 'aura-courier' (got '${json.name}')`);
  assert(json.displayName === 'Aura Courier MCP', `displayName is 'Aura Courier MCP'`);
  assert(json.version === '2.5.1', `version is '2.5.1'`);
  assert(json.category === 'Business / Logistics', `category is 'Business / Logistics'`);
  assert(typeof json.description === 'string' && json.description.length > 20, 'description is informative');
  assert(json.logo === 'assets/logo.svg', `logo points to 'assets/logo.svg'`);
  assert(Array.isArray(json.suggestedPrompts) && json.suggestedPrompts.length === 3, `suggestedPrompts contains exactly 3 starter prompts`);
  assert(json.author && json.author.name && json.author.email, 'author metadata is complete');
  assert(json.partner && json.partner.googleCloudPartnerUrl.includes('aura-ajentic-ai'), 'Google Cloud Partner Advantage link is present');
  assert(json.repository && (typeof json.repository === 'string' || json.repository.url), 'source repository is configured');
  assert(json.repository.url.includes('auraajenticai/aura-courier-mcp'), 'repository points to official auraajenticai/aura-courier-mcp');
  assert(json.license === 'Apache-2.0', 'license is Apache-2.0');
  assert(Array.isArray(json.keywords) && json.keywords.length >= 5, 'keywords tags array is populated');
  assert(json.mcpServers && json.mcpServers['aura-courier'] && json.mcpServers['aura-courier'].url, 'mcpServers declaration exists in manifest');
}

async function validateMcpConfig() {
  console.log('\n--- 2. Validating mcp_config.json ---');
  const mcpConfigPath = path.join(PLUGIN_DIR, 'mcp_config.json');
  assert(fs.existsSync(mcpConfigPath), 'mcp_config.json exists');

  const content = fs.readFileSync(mcpConfigPath, 'utf8');
  const json = JSON.parse(content);
  assert(json.mcpServers && json.mcpServers['aura-courier'], 'server aura-courier is declared');
  assert(json.mcpServers['aura-courier'].url === 'https://courier.auraajenticai.cloud/mcp', 'remote MCP endpoint is https://courier.auraajenticai.cloud/mcp');
  assert(json.mcpServers['aura-courier'].transport === 'streamable-http', 'transport is streamable-http');
}

async function validateAssets() {
  console.log('\n--- 3. Validating Assets ---');
  const logoPath = path.join(PLUGIN_DIR, 'assets', 'logo.svg');
  assert(fs.existsSync(logoPath), 'assets/logo.svg exists');
  const logoContent = fs.readFileSync(logoPath, 'utf8');
  assert(logoContent.includes('<svg') && logoContent.includes('</svg>'), 'logo.svg is valid XML/SVG');
  assert(logoContent.includes('viewBox="0 0 1024 1024"'), 'logo.svg is square 1024x1024 asset');
}

async function validateSkillsAndRules() {
  console.log('\n--- 4. Validating Skills & Rules ---');
  const skillPath = path.join(PLUGIN_DIR, 'skills', 'courier-ops', 'SKILL.md');
  assert(fs.existsSync(skillPath), 'skills/courier-ops/SKILL.md exists');
  const skillContent = fs.readFileSync(skillPath, 'utf8');
  assert(skillContent.startsWith('---') && skillContent.includes('name: courier-ops'), 'skill has valid YAML frontmatter');

  const expectedTools = [
    'list_couriers',
    'create_parcel',
    'track_parcel',
    'get_balance',
    'check_fraud_risk',
    'validate_and_geocode_address',
    'calculate_delivery_zone_and_fee',
    'compare_courier_rates',
    'resolve_ndr_issue'
  ];
  for (const tool of expectedTools) {
    assert(skillContent.includes(`\`${tool}\``), `skill documents tool '${tool}'`);
  }

  const courierRulesPath = path.join(PLUGIN_DIR, 'rules', 'COURIER_RULES.md');
  const agentsPath = path.join(PLUGIN_DIR, 'rules', 'AGENTS.md');
  assert(fs.existsSync(courierRulesPath), 'rules/COURIER_RULES.md exists');
  assert(fs.existsSync(agentsPath), 'rules/AGENTS.md exists');

  const ruleContent = fs.readFileSync(courierRulesPath, 'utf8');
  assert(ruleContent.includes('Zero Mock Data Mandate'), 'COURIER_RULES enforces Zero Mock Data');
  assert(ruleContent.includes('Steadfast') && ruleContent.includes('Pathao') && ruleContent.includes('RedX') && ruleContent.includes('Paperfly'), 'all 4 carriers are governed');
  assert(ruleContent.includes('Google Maps Platform'), 'Google Maps geocoding policy is defined');
}

async function validateRemoteMcpServer() {
  console.log('\n--- 5. Validating Live Remote MCP Handshake & Tools ---');
  const endpoint = 'https://courier.auraajenticai.cloud/mcp';
  try {
    const initRes = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream'
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'antigravity-validator', version: '2.5.1' }
        }
      })
    });

    assert(initRes.status === 200, `initialize endpoint returned HTTP 200 (got ${initRes.status})`);
    const sessionId = initRes.headers.get('mcp-session-id');
    assert(!!sessionId, `mcp-session-id header received: ${sessionId}`);

    const initData = await initRes.json();
    assert(initData.result && initData.result.serverInfo && initData.result.serverInfo.name === 'aura-courier-mcp', 'serverInfo is aura-courier-mcp');

    const toolsRes = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
        'mcp-session-id': sessionId
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/list',
        params: {}
      })
    });

    assert(toolsRes.status === 200, `tools/list returned HTTP 200`);
    const toolsData = await toolsRes.json();
    const liveTools = toolsData.result?.tools || [];
    assert(liveTools.length === 9, `exactly 9 tools returned by remote server (got ${liveTools.length})`);

    const liveToolNames = liveTools.map(t => t.name);
    console.log(`  Live tools on server: [ ${liveToolNames.join(', ')} ]`);
    assert(liveToolNames.includes('create_parcel'), 'create_parcel tool is live');
    assert(liveToolNames.includes('check_fraud_risk'), 'check_fraud_risk tool is live');
    assert(liveToolNames.includes('validate_and_geocode_address'), 'validate_and_geocode_address tool is live');
  } catch (err) {
    assert(false, `Remote MCP server connection error: ${err.message}`);
  }
}

async function run() {
  console.log('====================================================');
  console.log('  Aura Courier MCP — Antigravity Plugin Validator   ');
  console.log('====================================================');
  await validateManifest();
  await validateMcpConfig();
  await validateAssets();
  await validateSkillsAndRules();
  await validateRemoteMcpServer();

  console.log('\n====================================================');
  console.log(`  Result: ${passedChecks}/${totalChecks} checks passed.`);
  console.log('====================================================\n');
  if (process.exitCode) {
    process.exit(1);
  }
}

run();
