/**
 * Static public pages served by the HTTP server: landing, privacy policy, and
 * docs. These give the connector stable public HTTPS URLs required for the
 * Anthropic Connectors Directory submission (privacy policy + setup docs).
 */
const SHELL = (title, body) => `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
:root{--bg:#07080a;--card:#0f1115;--line:#1c1f27;--ink:#f4f5f7;--dim:#a4a8b3;--violet:#7c5cff;--cyan:#00d4ff}
*{box-sizing:border-box;margin:0;padding:0}
body{background:var(--bg);color:var(--ink);font-family:'Segoe UI',system-ui,sans-serif;line-height:1.7}
.wrap{max-width:860px;margin:0 auto;padding:48px 22px}
a{color:var(--cyan)}
h1{font-size:30px;letter-spacing:-.02em;margin-bottom:6px}
h1 .g{background:linear-gradient(120deg,#7c5cff,#00d4ff);-webkit-background-clip:text;background-clip:text;color:transparent}
h2{font-size:19px;margin:28px 0 8px;color:#c4b5fd}
p,li{color:var(--dim);font-size:15px}ul{margin:8px 0 8px 20px}
.tag{font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--violet);margin-bottom:14px}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:18px;margin:14px 0}
code{background:#12141d;border:1px solid var(--line);border-radius:6px;padding:2px 7px;font-size:13px;color:#7fe3ff}
pre{background:#0c0e13;border:1px solid var(--line);border-radius:10px;padding:14px;overflow-x:auto;font-size:13px;color:#cfe;margin:10px 0}
.muted{color:#6b7080;font-size:13px;margin-top:32px;border-top:1px solid var(--line);padding-top:16px}
</style></head><body><div class="wrap">${body}
<div class="muted">Aura Agentic AI Cloud · <a href="https://auraajenticai.cloud">auraajenticai.cloud</a> · <a href="/docs">Docs</a> · <a href="/privacy">Privacy</a> · Support: hello@auraajenticai.cloud</div>
</div></body></html>`;
export const LANDING_HTML = `<!doctype html>
<html lang="bn">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="description" content="Aura Courier MCP — one MCP connector for every Bangladesh courier.">
<title>Aura Courier MCP</title>
<style>
  /* Dark, blue/violet, code-aesthetic — matched to auraajenticai.cloud */
  :root{
    --bg:#09090f; --bg2:#0c0d15; --surface:#13141d; --surface2:#191b27;
    --ink:#edeff5; --muted:#969db4; --faint:#5c6482; --line:#23283a;
    --blue:#4d7cff; --violet:#8b5cf6; --cyan:#38bdf8;
    --green:#46d17f; --green-bg:#0f2a1d; --amber:#e0a341; --amber-bg:#2a2110;
    --code-ink:#c8d0e6; --shadow:0 1px 2px rgba(0,0,0,.5),0 20px 50px rgba(0,0,0,.45);
    --grad:linear-gradient(100deg,var(--blue),var(--violet));
  }
  *{box-sizing:border-box}
  body{margin:0}
  .wrap{font-family:-apple-system,"Segoe UI",Roboto,system-ui,sans-serif; background:var(--bg); color:var(--ink); line-height:1.6; -webkit-font-smoothing:antialiased}
  .page{max-width:960px; margin:0 auto; padding:0 22px}
  .mono{font-family:"SF Mono",ui-monospace,"Cascadia Code","JetBrains Mono",Menlo,Consolas,monospace}
  a{color:var(--blue)}
  h1,h2,h3{line-height:1.15; margin:0; text-wrap:balance}
  .eyebrow{font-family:"SF Mono",ui-monospace,monospace; font-size:12px; letter-spacing:.14em; text-transform:uppercase; color:var(--blue); font-weight:600}

  /* hero */
  .hero{text-align:center; padding:74px 22px 52px; position:relative; overflow:hidden; border-bottom:1px solid var(--line)}
  .hero::before{content:""; position:absolute; inset:0;
    background:
      radial-gradient(55% 45% at 50% -5%, color-mix(in srgb,var(--blue) 22%, transparent), transparent 68%),
      radial-gradient(40% 40% at 82% 20%, color-mix(in srgb,var(--violet) 16%, transparent), transparent 70%);
    pointer-events:none}
  .hero::after{content:""; position:absolute; inset:0; opacity:.5; pointer-events:none;
    background-image:linear-gradient(var(--line) 1px,transparent 1px),linear-gradient(90deg,var(--line) 1px,transparent 1px);
    background-size:52px 52px; mask-image:radial-gradient(70% 60% at 50% 0%,#000,transparent 75%); -webkit-mask-image:radial-gradient(70% 60% at 50% 0%,#000,transparent 75%)}
  .hero > *{position:relative}
  .mark{display:inline-flex; align-items:center; gap:11px; margin-bottom:26px}
  .mark svg{width:32px;height:32px}
  .mark span{font-weight:800; font-size:13.5px; letter-spacing:.04em}
  .mark span small{display:block; font-family:"SF Mono",monospace; font-size:9.5px; letter-spacing:.22em; color:var(--blue); font-weight:600; text-transform:uppercase; margin-top:2px}
  .badge-live{display:inline-flex; align-items:center; gap:7px; font-size:12px; font-weight:600; color:var(--green); background:var(--green-bg); border:1px solid color-mix(in srgb,var(--green) 30%,transparent); padding:5px 13px; border-radius:999px; margin-bottom:22px}
  .badge-live .d{width:7px;height:7px;border-radius:50%;background:var(--green);box-shadow:0 0 8px var(--green)}
  .hero h1{font-size:clamp(36px,7.5vw,66px); font-weight:800; letter-spacing:-.03em}
  .hero h1 em{font-family:Georgia,"Times New Roman",serif; font-style:italic; font-weight:500; background:var(--grad); -webkit-background-clip:text; background-clip:text; color:transparent}
  .hero .tagline{font-size:clamp(16px,2.4vw,20px); color:var(--muted); max-width:36ch; margin:20px auto 0}
  .cta-row{display:flex; gap:12px; justify-content:center; flex-wrap:wrap; margin-top:34px}
  .btn{display:inline-flex; align-items:center; gap:8px; font-weight:700; font-size:15px; padding:13px 24px; border-radius:11px; text-decoration:none; border:1px solid transparent; transition:transform .12s ease}
  .btn:hover{transform:translateY(-1px)}
  .btn-primary{background:var(--grad); color:#fff; box-shadow:0 8px 24px color-mix(in srgb,var(--blue) 34%, transparent)}
  .btn-ghost{background:color-mix(in srgb,var(--surface) 80%,transparent); color:var(--ink); border-color:var(--line)}
  .hero-meta{display:flex; gap:10px 20px; justify-content:center; flex-wrap:wrap; margin-top:32px; font-family:"SF Mono",monospace; font-size:12.5px; color:var(--faint); font-weight:600}
  .hero-meta b{color:var(--ink)}

  section.blk{padding:48px 0; border-top:1px solid var(--line)}
  .blk-head{margin-bottom:26px}
  .blk-head h2{font-size:27px; font-weight:800; letter-spacing:-.015em; margin-top:9px}
  .blk-head p{color:var(--muted); margin:9px 0 0; max-width:62ch}

  .tools{display:grid; grid-template-columns:repeat(auto-fit,minmax(215px,1fr)); gap:14px}
  .tool{background:var(--surface); border:1px solid var(--line); border-radius:13px; padding:18px 20px; box-shadow:var(--shadow); transition:border-color .15s}
  .tool:hover{border-color:color-mix(in srgb,var(--blue) 45%,var(--line))}
  .tool .name{font-family:"SF Mono",monospace; font-size:14px; font-weight:600; color:var(--blue)}
  .tool p{margin:8px 0 0; font-size:14px; color:var(--muted)}

  .couriers{display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); gap:12px}
  .courier{background:var(--surface); border:1px solid var(--line); border-radius:13px; padding:18px 20px; display:flex; flex-direction:column; gap:9px; box-shadow:var(--shadow)}
  .courier .cn{font-weight:800; font-size:16px}
  .pill{align-self:flex-start; font-size:11.5px; font-weight:600; padding:3px 10px; border-radius:999px; letter-spacing:.02em; font-family:"SF Mono",monospace}
  .pill.live{background:var(--green-bg); color:var(--green)}
  .pill.soon{background:var(--amber-bg); color:var(--amber)}

  .connect{background:var(--surface); border:1px solid var(--line); border-radius:16px; padding:8px; box-shadow:var(--shadow); overflow:hidden}
  .connect .bar{display:flex; align-items:center; gap:7px; padding:11px 14px}
  .dot{width:11px;height:11px;border-radius:50%}
  .connect .fn{margin-left:8px; font-size:12.5px; color:var(--faint); font-weight:600}
  pre.code{margin:0; background:var(--bg2); color:var(--code-ink); border-radius:11px; padding:18px 20px; overflow-x:auto; font-size:13px; line-height:1.7; border:1px solid var(--line)}
  pre.code .k{color:var(--cyan)} pre.code .s{color:var(--green)} pre.code .c{color:var(--faint)}
  .steps3{display:grid; grid-template-columns:repeat(3,1fr); gap:14px; margin-top:18px}
  @media(max-width:640px){.steps3{grid-template-columns:1fr}}
  .st{background:var(--surface); border:1px solid var(--line); border-radius:12px; padding:15px 17px}
  .st .n{font-family:"SF Mono",monospace; font-weight:700; color:var(--blue); font-variant-numeric:tabular-nums}
  .st p{margin:6px 0 0; font-size:14px; color:var(--ink)}

  .why{display:grid; grid-template-columns:1.25fr 1fr; gap:20px; align-items:center}
  @media(max-width:720px){.why{grid-template-columns:1fr}}
  .why ul{margin:0; padding-left:18px; color:var(--muted); font-size:15px}
  .why li{margin:9px 0} .why li b{color:var(--ink)}
  .vision{background:linear-gradient(150deg,var(--surface2),var(--surface)); border:1px solid var(--line); border-radius:16px; padding:26px 28px; box-shadow:var(--shadow); position:relative; overflow:hidden}
  .vision::before{content:""; position:absolute; inset:0; background:radial-gradient(60% 60% at 100% 0%,color-mix(in srgb,var(--violet) 18%,transparent),transparent 70%); pointer-events:none}
  .vision .tag{font-family:"SF Mono",monospace; font-size:11px; font-weight:600; letter-spacing:.08em; text-transform:uppercase; color:var(--blue); position:relative}
  .vision h3{font-size:21px; font-weight:800; margin-top:12px; position:relative}
  .vision p{color:var(--muted); margin:12px 0 0; font-size:14.5px; position:relative}

  footer{border-top:1px solid var(--line); padding:32px 0 60px; color:var(--faint); font-size:13px; text-align:center}
  footer a{color:var(--blue); text-decoration:none}
  footer b{color:var(--ink)}
  @media (prefers-reduced-motion:reduce){.btn{transition:none}}
</style>
</head>
<body>


<div class="wrap">
  <div class="hero">
    <div class="mark">
      <svg viewBox="0 0 40 40" fill="none" aria-hidden="true">
        <circle cx="20" cy="14" r="9" stroke="url(#g)" stroke-width="2.5"/>
        <circle cx="13.5" cy="25" r="9" stroke="url(#g)" stroke-width="2.5" opacity=".6"/>
        <circle cx="26.5" cy="25" r="9" stroke="url(#g)" stroke-width="2.5" opacity=".38"/>
        <defs><linearGradient id="g" x1="0" y1="0" x2="40" y2="40"><stop stop-color="#4d7cff"/><stop offset="1" stop-color="#8b5cf6"/></linearGradient></defs>
      </svg>
      <span>AURA AGENTIC AI<small>Neural Verified Commerce</small></span>
    </div>
    <div class="badge-live"><span class="d"></span> Model Context Protocol · Bangladesh</div>
    <h1>Aura <em>Courier</em> MCP</h1>
    <p class="tagline">এক connector — বাংলাদেশের সব courier। Claude থেকেই parcel বুক করুন ও ট্র্যাক করুন।</p>
    <div class="cta-row">
      <a class="btn btn-primary" href="/docs">⚡ Add to Claude</a>
      <a class="btn btn-ghost" href="https://github.com/auraajenticai/aura-courier-mcp">★ View on GitHub</a>
    </div>
    <div class="hero-meta mono">
      <span><b>5</b> tools</span>
      <span><b>2</b> couriers live</span>
      <span>book · track · balance</span>
      <span>open source · MIT</span>
    </div>
  </div>

  <div class="page">

    <section class="blk">
      <div class="blk-head">
        <div class="eyebrow">// what it does</div>
        <h2>One interface, every courier</h2>
        <p>প্রতিটা courier আলাদা API — Aura Courier MCP সবগুলোকে একই সহজ toolset-এ এনে দেয়। Claude-কে বলুন, ও বাকিটা করবে।</p>
      </div>
      <div class="tools">
        <div class="tool"><div class="name">create_parcel</div><p>যেকোনো courier-এ ডেলিভারি বুক করুন — consignment ID + tracking code ফেরত।</p></div>
        <div class="tool"><div class="name">track_parcel</div><p>consignment / invoice / tracking code দিয়ে ডেলিভারি স্ট্যাটাস।</p></div>
        <div class="tool"><div class="name">get_balance</div><p>courier অ্যাকাউন্টের ব্যালেন্স (BDT)।</p></div>
        <div class="tool"><div class="name">get_courier_locations</div><p>city / zone / area ID resolve (Pathao-র জন্য)।</p></div>
        <div class="tool"><div class="name">list_couriers</div><p>কোন courier যুক্ত ও কনফিগার করা আছে।</p></div>
      </div>
    </section>

    <section class="blk">
      <div class="blk-head">
        <div class="eyebrow">// couriers</div>
        <h2>একই tools, যত খুশি courier</h2>
        <p>নতুন courier = একটা adapter যোগ। আপনার সব courier এক জায়গায়।</p>
      </div>
      <div class="couriers">
        <div class="courier"><span class="cn">Steadfast</span><span class="pill live">● live</span></div>
        <div class="courier"><span class="cn">Pathao</span><span class="pill live">● live</span></div>
        <div class="courier"><span class="cn">RedX</span><span class="pill soon">◐ coming</span></div>
        <div class="courier"><span class="cn">Paperfly</span><span class="pill soon">◐ coming</span></div>
      </div>
    </section>

    <section class="blk">
      <div class="blk-head">
        <div class="eyebrow">// connect</div>
        <h2>দুইভাবে যুক্ত করুন</h2>
        <p>Hosted — কিছু install লাগবে না; অথবা লোকাল (Claude Desktop/Code)।</p>
      </div>
      <div class="connect" style="margin-bottom:16px">
        <div class="bar">
          <span class="dot" style="background:#46d17f"></span>
          <span class="fn mono">Hosted · Claude → Settings → Connectors → Add custom connector</span>
        </div>
<pre class="code mono"><span class="c"># এই URL বসান — নিজের courier key দিন (কিছু install না)</span>
https://courier.auraajenticai.cloud/mcp?steadfast_key=<span class="s">YOUR_KEY</span>&steadfast_secret=<span class="s">YOUR_SECRET</span></pre>
      </div>
      <p style="color:var(--faint); font-size:13px; margin:0 0 14px" class="mono">— or local (stdio) —</p>
      <div class="connect">
        <div class="bar">
          <span class="dot" style="background:#e5766f"></span><span class="dot" style="background:#e0a341"></span><span class="dot" style="background:#46d17f"></span>
          <span class="fn mono">claude_desktop_config.json</span>
        </div>
<pre class="code mono"><span class="c">// Claude config-এ যোগ করুন</span>
{
  <span class="k">"mcpServers"</span>: {
    <span class="k">"aura-courier"</span>: {
      <span class="k">"command"</span>: <span class="s">"npx"</span>,
      <span class="k">"args"</span>: [<span class="s">"-y"</span>, <span class="s">"github:auraajenticai/aura-courier-mcp"</span>],
      <span class="k">"env"</span>: {
        <span class="k">"STEADFAST_API_KEY"</span>: <span class="s">"your-key"</span>,
        <span class="k">"STEADFAST_SECRET_KEY"</span>: <span class="s">"your-secret"</span>
      }
    }
  }
}</pre>
      </div>
      <div class="steps3">
        <div class="st"><div class="n">01</div><p>নিজের courier merchant API key নিন</p></div>
        <div class="st"><div class="n">02</div><p>উপরের config Claude-এ বসান</p></div>
        <div class="st"><div class="n">03</div><p>বলুন — "invoice A-1001-এর parcel বুক করো" ✅</p></div>
      </div>
    </section>

    <section class="blk">
      <div class="blk-head">
        <div class="eyebrow">// why aura</div>
        <h2>বাংলাদেশের commerce, agentic-ready</h2>
      </div>
      <div class="why">
        <ul>
          <li><b>BD-first:</b> Steadfast, Pathao — যা global connector-রা চেনেই না।</li>
          <li><b>Adapter architecture:</b> এক interface, ভেতরে যত খুশি courier।</li>
          <li><b>Bring-your-own keys:</b> আপনার courier account আপনারই থাকে।</li>
          <li><b>Aura BD Commerce Suite-এর অংশ</b> — courier + payments, শীঘ্রই একসাথে।</li>
        </ul>
        <div class="vision">
          <span class="tag">the vision</span>
          <h3>এক ছাদের নিচে দেশের সব commerce API</h3>
          <p>Aura বানাচ্ছে বাংলাদেশের agentic commerce স্তর — courier, payments, আরও অনেক connector — যাতে যেকোনো AI সহজেই দেশের ব্যবসার সাথে কাজ করতে পারে।</p>
        </div>
      </div>
    </section>

  </div>

  <footer>
    <p><b>Aura Courier MCP</b> · built by <a href="https://auraajenticai.cloud">Aura Agentic AI</a> · MIT License</p>
    <p style="margin-top:6px"><a href="/docs">Setup &amp; usage docs</a> · <a href="/privacy">Privacy policy</a> · Support: hello@auraajenticai.cloud</p>
    <p style="margin-top:6px" class="mono"><a href="https://github.com/auraajenticai/aura-courier-mcp">github.com/auraajenticai/aura-courier-mcp</a></p>
  </footer>
</div>

</body>
</html>
`;
export const PRIVACY_HTML = SHELL("Privacy Policy — Aura Courier MCP", `<div class="tag">Legal</div>
  <h1>Privacy Policy</h1>
  <p><b>Aura Courier MCP</b> — operated by Aura Agentic AI Cloud. Last updated: 27 July 2026.</p>

  <h2>1. What data we process</h2>
  <ul>
    <li><b>Courier credentials</b> you supply when connecting (Steadfast API key &amp; secret, and/or Pathao client id, secret, username, password). These are your own courier-account credentials.</li>
    <li><b>Parcel details</b> you pass to a tool: recipient name, phone, address, COD amount, invoice/order id, and optional notes.</li>
    <li><b>Tracking identifiers</b> (consignment id, invoice, tracking code) for status lookups.</li>
  </ul>

  <h2>2. How we use it</h2>
  <p>Solely to call the courier's own API on your behalf — to create a parcel, track it, check balance, or resolve locations. We do not use your data for any other purpose, and we do not use it to train models.</p>

  <h2>3. Storage &amp; retention</h2>
  <p>The service is <b>stateless</b>. Credentials and parcel data are read from your request, used for that single request, and <b>not persisted</b> — we keep no database of your credentials, orders, or customers. Nothing is retained after the request completes.</p>

  <h2>4. Third-party sharing</h2>
  <p>Data is transmitted only to the courier you select (Steadfast / Packzy or Pathao) over HTTPS, to fulfil your request. We do not sell, rent, or share your data with anyone else. Each courier's own privacy terms apply to the data they receive.</p>

  <h2>5. Security</h2>
  <p>All traffic is over HTTPS/TLS. Credentials travel only within your own connector configuration and the request to the courier; they are never written to persistent storage by this service.</p>

  <h2>6. Your control</h2>
  <p>You control the connection. Remove the connector at any time to stop all processing. Because we store nothing, there is no retained data to delete.</p>

  <h2>7. Contact</h2>
  <p>Questions or requests: <b>hello@auraajenticai.cloud</b> · Aura Agentic AI Cloud, Bangladesh.</p>`);
export const DOCS_HTML = SHELL("Docs — Aura Courier MCP", `<div class="tag">Documentation</div>
  <h1>Aura Courier MCP — Setup &amp; Usage</h1>

  <h2>Requirements</h2>
  <ul>
    <li>A <b>Steadfast (Packzy)</b> merchant account with an API key + secret key, and/or</li>
    <li>A <b>Pathao Merchant</b> account with client id, client secret, username, password, and a store id.</li>
  </ul>

  <h2>Add the connector to Claude</h2>
  <p>Add a custom connector with the server URL and your courier credentials. Credentials can be passed as URL query parameters or as request headers. Example (Steadfast):</p>
  <pre>https://courier.auraajenticai.cloud/mcp?steadfast_key=YOUR_KEY&amp;steadfast_secret=YOUR_SECRET</pre>
  <p>For Pathao, add: <code>pathao_client_id</code>, <code>pathao_client_secret</code>, <code>pathao_username</code>, <code>pathao_password</code>, <code>pathao_store_id</code> (and <code>pathao_sandbox=true</code> to use Pathao's sandbox). Header equivalents use the <code>x-</code> prefix, e.g. <code>x-steadfast-key</code>.</p>
  <p>Nothing is stored server-side — your keys live only in your own connector configuration and travel over HTTPS.</p>

  <h2>Tools</h2>
  <div class="card">
    <p><b>list_couriers</b> — list supported couriers and whether each is configured. <i>(read-only)</i></p>
    <p><b>create_parcel</b> — book a delivery. Needs <code>courier</code>, <code>invoice</code> (unique), <code>recipientName</code>, <code>recipientPhone</code> (01XXXXXXXXX), <code>recipientAddress</code>, <code>codAmount</code> (BDT, 0 = prepaid). Pathao also needs <code>meta:{ storeId, cityId, zoneId, areaId }</code>. <i>(write)</i></p>
    <p><b>track_parcel</b> — status by consignment id, invoice, or tracking code. <i>(read-only)</i></p>
    <p><b>get_balance</b> — merchant courier balance in BDT. <i>(read-only)</i></p>
    <p><b>get_courier_locations</b> — resolve Pathao city / zone / area IDs. <i>(read-only)</i></p>
  </div>

  <h2>Example</h2>
  <p>"Book a Steadfast delivery for order INV-1001 to Rahim, 01700000000, Mirpur Dhaka, COD 1250 taka." → Claude calls <code>create_parcel</code> and returns the consignment id + tracking code.</p>

  <h2>Support</h2>
  <p><b>hello@auraajenticai.cloud</b></p>`);
//# sourceMappingURL=pages.js.map