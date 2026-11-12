// World and Bangladesh Courier Hub Canvas Engine
function initCourierCanvas(canvasId = 'hubmap') {
  const cv = document.getElementById(canvasId);
  if (!cv) return;
  const ctx = cv.getContext('2d');
  const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Major Global Logistics Gateways
  const HUBS = [
    ['Dhaka', 23.81, 90.41, 1], ['Singapore', 1.35, 103.8], ['Dubai', 25.2, 55.3], ['Hong Kong', 22.3, 114.2],
    ['Shanghai', 31.2, 121.5], ['Tokyo', 35.7, 139.7], ['Mumbai', 19.1, 72.9], ['Delhi', 28.6, 77.2],
    ['Bangkok', 13.75, 100.5], ['Kuala Lumpur', 3.1, 101.7], ['Istanbul', 41.0, 28.98], ['Frankfurt', 50.1, 8.68],
    ['London', 51.5, -0.13], ['Paris', 48.85, 2.35], ['New York', 40.7, -74.0], ['Los Angeles', 34.05, -118.2],
    ['Chicago', 41.88, -87.6], ['Sao Paulo', -23.55, -46.6], ['Sydney', -33.87, 151.2], ['Johannesburg', -26.2, 28.0],
    ['Cairo', 30.04, 31.2], ['Moscow', 55.75, 37.6], ['Seoul', 37.57, 126.98], ['Toronto', 43.65, -79.38],
    ['Jakarta', -6.2, 106.8], ['Riyadh', 24.7, 46.7], ['Kolkata', 22.57, 88.36], ['Yangon', 16.87, 96.2],
    ['Mexico City', 19.43, -99.13], ['Buenos Aires', -34.6, -58.38], ['Vancouver', 49.28, -123.12]
  ];
  const WLABELS = new Set(['Dhaka', 'Singapore', 'Dubai', 'London', 'New York', 'Hong Kong', 'Frankfurt', 'Tokyo', 'Sydney']);

  // Bangladesh Nationwide Courier Hub Network (Steadfast, Pathao, RedX, Paperfly)
  // [Name, Lat, Lon, isPrimaryHub, courierAffinity]
  const BD = [
    ['Dhaka (Central Hub)', 23.81, 90.41, 1, 'all'],
    ['Chattogram Hub', 22.36, 91.80, 1, 'steadfast'],
    ['Sylhet Express', 24.90, 91.87, 1, 'pathao'],
    ['Khulna Gateway', 22.85, 89.56, 1, 'paperfly'],
    ['Rajshahi Hub', 24.37, 88.60, 1, 'redx'],
    ['Rangpur Northern', 25.75, 89.25, 0, 'steadfast'],
    ['Barishal Riverine', 22.70, 90.37, 0, 'paperfly'],
    ['Coxs Bazar Hub', 21.43, 91.99, 0, 'pathao'],
    ['Cumilla Express', 23.46, 91.18, 0, 'redx'],
    ['Bogura Hub', 24.85, 89.37, 0, 'steadfast'],
    ['Mymensingh Hub', 24.75, 90.40, 0, 'pathao'],
    ['Jashore Hub', 23.17, 89.21, 0, 'redx'],
    ['Dinajpur Hub', 25.63, 88.64, 0, 'paperfly'],
    ['Tetulia North', 26.49, 88.40, 1, 'steadfast'],
    ['Teknaf South', 20.86, 92.30, 1, 'pathao'],
    ['Rupsha West', 22.79, 89.63, 1, 'paperfly'],
    ['Pathuria East', 24.40, 92.05, 1, 'redx']
  ];

  const CARRIER_COLORS = {
    steadfast: { stroke: 'rgba(16, 185, 129, 0.40)', glow: 'rgba(16, 185, 129, 0.35)', core: '#6ee7b7' }, // Emerald
    pathao:    { stroke: 'rgba(244, 63, 94, 0.40)',  glow: 'rgba(244, 63, 94, 0.35)',  core: '#fda4af' }, // Rose/Red
    redx:      { stroke: 'rgba(239, 68, 68, 0.38)',  glow: 'rgba(239, 68, 68, 0.32)',  core: '#fca5a5' }, // Red
    paperfly:  { stroke: 'rgba(59, 130, 246, 0.40)', glow: 'rgba(59, 130, 246, 0.35)', core: '#93c5fd' }, // Blue
    all:       { stroke: 'rgba(6, 182, 212, 0.45)',  glow: 'rgba(6, 182, 212, 0.40)',  core: '#a5f3fc' }  // Cyan
  };

  const LAT_TOP = 74, LAT_BOT = -56;
  let W, H, DPR, pts, conns, bdPts, bdConns, raf, last = 0, dtG = 0.016;
  const proj = (lat, lon) => [(lon + 180) / 360 * W, (LAT_TOP - lat) / (LAT_TOP - LAT_BOT) * H];
  const bez = (a, cx, cy, b, t) => {
    const u = 1 - t;
    return [u * u * a.x + 2 * u * t * cx + t * t * b.x, u * u * a.y + 2 * u * t * cy + t * t * b.y];
  };
  function mk(a, b, sp, carrier = 'all') {
    const d = Math.hypot(b.x - a.x, b.y - a.y);
    return {
      a, b,
      cx: (a.x + b.x) / 2,
      cy: (a.y + b.y) / 2 - Math.min(d * 0.22, 140),
      t: Math.random(),
      sp: sp || (0.12 + Math.random() * 0.16),
      carrier
    };
  }

  function build() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth;
    H = window.innerHeight;
    cv.width = W * DPR;
    cv.height = H * DPR;
    cv.style.width = W + 'px';
    cv.style.height = H + 'px';
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);

    pts = HUBS.map(h => {
      const p = proj(h[1], h[2]);
      return { name: h[0], x: p[0], y: p[1], big: h[3] || 0, lbl: WLABELS.has(h[0]) };
    });
    const dhaka = pts[0];
    conns = [];
    for (let i = 1; i < pts.length; i++) conns.push(mk(dhaka, pts[i], 0.10 + Math.random() * 0.12, 'all'));
    for (let k = 0; k < 15; k++) {
      const a = pts[1 + (Math.random() * (pts.length - 1) | 0)];
      const b = pts[1 + (Math.random() * (pts.length - 1) | 0)];
      if (a !== b) conns.push(mk(a, b, 0.08 + Math.random() * 0.1, 'all'));
    }

    const S = Math.max(26, Math.min(62, Math.min(H * 0.088, W * 0.09)));
    const ax = Math.min(dhaka.x, W - 6.4 * S - 60);
    const ay = Math.min(Math.max(dhaka.y, 3.4 * S + 24), H - 5.4 * S - 12);
    const lp = (lat, lon) => [ax + (lon - 90.41) * S, ay - (lat - 23.81) * S];

    bdPts = BD.map(c => {
      const p = lp(c[1], c[2]);
      return { name: c[0], x: p[0], y: p[1], lbl: c[3], carrier: c[4] };
    });
    const byName = {};
    bdPts.forEach(p => byName[p.name] = p);
    const bd0 = bdPts[0]; // Dhaka Central

    bdConns = [];
    for (let i = 1; i < bdPts.length; i++) {
      const dest = bdPts[i];
      bdConns.push(mk(bd0, dest, 0.18 + Math.random() * 0.15, dest.carrier));
    }
    // Major inter-district trunk corridors
    const corridors = [
      ['Teknaf South', 'Tetulia North', 'steadfast'],
      ['Rupsha West', 'Pathuria East', 'paperfly'],
      ['Chattogram Hub', 'Sylhet Express', 'pathao'],
      ['Khulna Gateway', 'Rangpur Northern', 'steadfast'],
      ['Coxs Bazar Hub', 'Dinajpur Hub', 'redx']
    ];
    corridors.forEach(pr => {
      const a = byName[pr[0]], b = byName[pr[1]];
      if (a && b) bdConns.push(mk(a, b, 0.14 + Math.random() * 0.1, pr[2]));
    });
  }

  function grid() {
    ctx.strokeStyle = 'rgba(96, 112, 160, 0.08)';
    ctx.lineWidth = 1;
    for (let la = LAT_TOP - 12; la > LAT_BOT; la -= 22) {
      const p = proj(la, 0);
      ctx.beginPath(); ctx.moveTo(0, p[1]); ctx.lineTo(W, p[1]); ctx.stroke();
    }
    for (let lo = -150; lo < 180; lo += 30) {
      const p = proj(0, lo);
      ctx.beginPath(); ctx.moveTo(p[0], 0); ctx.lineTo(p[0], H); ctx.stroke();
    }
  }

  function drawArcs(list, defaultColors, rad = 7.5) {
    for (const c of list) {
      const col = CARRIER_COLORS[c.carrier] || defaultColors;
      ctx.beginPath();
      ctx.moveTo(c.a.x, c.a.y);
      ctx.quadraticCurveTo(c.cx, c.cy, c.b.x, c.b.y);
      ctx.strokeStyle = col.stroke;
      ctx.lineWidth = 1.2;
      ctx.stroke();

      if (!reduce) {
        c.t += c.sp * dtG;
        if (c.t > 1) c.t -= 1;
      }
      const p = bez(c.a, c.cx, c.cy, c.b, reduce ? 0.5 : c.t);
      // Outer particle glow
      ctx.fillStyle = col.glow;
      ctx.beginPath();
      ctx.arc(p[0], p[1], rad, 0, Math.PI * 2);
      ctx.fill();
      // Inner glowing packet
      ctx.fillStyle = col.core;
      ctx.beginPath();
      ctx.arc(p[0], p[1], 2.2, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function frame(ts) {
    dtG = Math.min((ts - last) / 1000, 0.05) || 0.016;
    last = ts;
    ctx.clearRect(0, 0, W, H);
    grid();

    // 1. Draw Global Freight Connections
    drawArcs(conns, { stroke: 'rgba(88,132,255,0.18)', glow: 'rgba(56,189,248,0.22)', core: '#a9e6ff' }, 7.5);

    // Global Hub nodes
    for (const p of pts) {
      ctx.fillStyle = p.big ? 'rgba(56,189,248,0.92)' : 'rgba(130,158,225,0.72)';
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.big ? 4.5 : 2.8, 0, Math.PI * 2);
      ctx.fill();
      if (p.lbl && p.name !== 'Dhaka') {
        ctx.fillStyle = 'rgba(160,168,196,0.48)';
        ctx.font = '500 11.5px "JetBrains Mono", monospace';
        ctx.fillText(p.name, p.x + 8, p.y + 4);
      }
    }

    // 2. Draw Bangladesh All-Courier Dispatch Lines
    drawArcs(bdConns, { stroke: 'rgba(56,189,248,0.35)', glow: 'rgba(52,211,153,0.36)', core: '#c9ffe9' }, 8.5);

    // Pulsing radar rings on Bangladesh hubs
    const pr = (ts % 3000) / 3000;
    for (const p of bdPts) {
      const isCentral = p.name.includes('Dhaka');
      const carrierCol = CARRIER_COLORS[p.carrier] || CARRIER_COLORS.all;

      if (!reduce && (p.lbl || isCentral)) {
        ctx.strokeStyle = isCentral
          ? 'rgba(6, 182, 212, ' + (0.55 * (1 - pr)) + ')'
          : carrierCol.glow.replace(/[\d.]+\)$/, (0.45 * (1 - pr)) + ')');
        ctx.lineWidth = isCentral ? 1.8 : 1.2;
        ctx.beginPath();
        ctx.arc(p.x, p.y, (isCentral ? 6 : 4) + pr * (isCentral ? 32 : 24), 0, Math.PI * 2);
        ctx.stroke();
      }

      ctx.fillStyle = isCentral ? '#00d4ff' : carrierCol.core;
      ctx.beginPath();
      ctx.arc(p.x, p.y, isCentral ? 5.5 : 3.8, 0, Math.PI * 2);
      ctx.fill();

      // Hub Label
      if (p.lbl || isCentral) {
        ctx.fillStyle = isCentral ? '#38bdf8' : 'rgba(226, 232, 240, 0.82)';
        ctx.font = (isCentral ? '700 ' : '600 ') + (isCentral ? '13px ' : '11.5px ') + '"JetBrains Mono", monospace';
        const cleanName = p.name.replace(/\s*\(.*\)/, '');
        ctx.fillText((isCentral ? '◆ ' : '• ') + cleanName, p.x + 8, p.y + 4);
      }
    }

    if (!reduce) raf = requestAnimationFrame(frame);
  }

  function start() {
    cancelAnimationFrame(raf);
    build();
    last = 0;
    frame(performance.now());
  }

  let rt;
  window.addEventListener('resize', () => {
    clearTimeout(rt);
    rt = setTimeout(start, 200);
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && !reduce) {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(frame);
    }
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
}

// Auto-initialize canvas on page load
if (typeof window !== 'undefined') {
  window.initCourierCanvas = initCourierCanvas;
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => initCourierCanvas('hubmap'));
  } else {
    initCourierCanvas('hubmap');
  }
}

