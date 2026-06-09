#!/usr/bin/env node
'use strict';

// Requires playwright installed globally at /opt/node22/lib/node_modules/playwright
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const OUT_DIR = path.join(__dirname, 'screenshot-library');
const VIEWPORT = { width: 375, height: 812, deviceScaleFactor: 2 };
const PORT = 7331;

const TABS = [
  { id: 'd', name: 'DAILIES' },
  { id: 'h', name: 'GIGS' },
  { id: 'c', name: 'MAIN' },
  { id: 's', name: 'SHOP' },
];

// ─── Collect commits ────────────────────────────────────────────────────────
const rawLog = execSync('git log --reverse --format=%H%x09%s%x09%ai -- index.html', {
  cwd: __dirname,
}).toString().trim();

const allCommits = rawLog.split('\n')
  .map(line => {
    const [hash, subject, date] = line.split('\t');
    return { hash, message: subject || '', date: date || '' };
  })
  .filter(c => c.hash && c.hash.length === 40);

// Every 5th commit (oldest → newest) → ~10 evenly-spread snapshots
const selected = allCommits.filter((_, i) => i % 5 === 0);

console.log(`\n📸 H PROJECT — Screenshot Library`);
console.log(`   ${selected.length} snapshots · ${TABS.length} tabs each\n`);

// ─── HTTP server ─────────────────────────────────────────────────────────────
let servedHTML = '';
const server = http.createServer((_req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(servedHTML);
});

// ─── Main ────────────────────────────────────────────────────────────────────
async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  await new Promise(resolve => server.listen(PORT, '127.0.0.1', resolve));
  const BASE_URL = `http://127.0.0.1:${PORT}/`;

  const browser = await chromium.launch({
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });

  const metadata = [];

  for (let i = 0; i < selected.length; i++) {
    const commit = selected[i];
    const short = commit.hash.slice(0, 7);
    const label = commit.message.slice(0, 60) + (commit.message.length > 60 ? '…' : '');
    console.log(`[${String(i + 1).padStart(2)}/${selected.length}] ${short}  ${label}`);

    try {
      servedHTML = execSync(`git show ${commit.hash}:index.html`, {
        cwd: __dirname,
        maxBuffer: 10 * 1024 * 1024,
      }).toString();
    } catch {
      console.log('       ✗ index.html not found at this commit');
      continue;
    }

    const commitDir = path.join(OUT_DIR, short);
    fs.mkdirSync(commitDir, { recursive: true });

    const screenshots = [];

    for (const tab of TABS) {
      const ctx = await browser.newContext({
        viewport: { width: VIEWPORT.width, height: VIEWPORT.height },
        deviceScaleFactor: VIEWPORT.deviceScaleFactor,
        extraHTTPHeaders: { 'Accept-Language': 'fr-FR' },
      });
      const page = await ctx.newPage();

      // Bypass PIN auth before any page script runs
      await page.addInitScript(() => {
        try {
          localStorage.setItem('cp_trusted', 'true');
          sessionStorage.setItem('cp_auth', 'true');
        } catch (_) { /* private browsing */ }
      });

      try {
        await page.goto(BASE_URL, { waitUntil: 'load', timeout: 20000 });
        // Wait for Google Fonts (Rajdhani, Doto, Bungee Hairline) to be fully applied
        await page.evaluate(() => document.fonts.ready);
        await page.waitForTimeout(800);

        // Force-hide auth overlay in case localStorage was blocked
        await page.evaluate(() => {
          const auth = document.getElementById('auth-screen');
          if (auth) auth.style.display = 'none';
          const app = document.getElementById('app');
          if (app) {
            app.style.pointerEvents = 'all';
            app.style.opacity = '1';
          }
        });

        // Navigate to the tab if go() exists
        const hasGo = await page.evaluate(() => typeof go === 'function').catch(() => false);
        if (hasGo) {
          await page.evaluate(id => go(id), tab.id);
          await page.waitForTimeout(350);
        } else if (tab.id !== 'd') {
          await ctx.close();
          continue;
        }

        const file = `${short}/${tab.id}.png`;
        await page.screenshot({
          path: path.join(OUT_DIR, file),
          clip: { x: 0, y: 0, width: VIEWPORT.width, height: VIEWPORT.height },
        });

        screenshots.push({ tab: tab.name, tabId: tab.id, file });
        process.stdout.write(`       ✓ ${tab.name}\n`);
      } catch (err) {
        process.stdout.write(`       ✗ ${tab.name}: ${err.message.split('\n')[0]}\n`);
      }

      await ctx.close();
    }

    if (screenshots.length) {
      metadata.push({
        index: i,
        hash: short,
        fullHash: commit.hash,
        message: commit.message,
        date: formatDate(commit.date),
        screenshots,
      });
    }
  }

  await browser.close();
  server.close();

  const galleryPath = path.join(OUT_DIR, 'index.html');
  fs.writeFileSync(galleryPath, buildGallery(metadata));
  console.log(`\n✅ Done!`);
  console.log(`   Gallery → ${galleryPath}`);
  console.log(`   Commits → ${metadata.length}  Screenshots → ${metadata.reduce((n, c) => n + c.screenshots.length, 0)}`);
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function formatDate(iso) {
  try {
    return new Date(iso).toLocaleDateString('fr-FR', {
      day: 'numeric', month: 'short', year: 'numeric',
    });
  } catch { return iso; }
}

function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ─── Gallery HTML ─────────────────────────────────────────────────────────────
function buildGallery(metadata) {
  const phoneCSS = `
    /* ── iPhone 13 mini frame ── */
    .phone-slot { display:flex; flex-direction:column; align-items:center; gap:8px; }
    .tab-label  { font-size:9px; letter-spacing:3px; color:rgba(252,238,10,.5); }

    /* Outer wrapper reserves the space of the scaled-down phone */
    .phone-wrapper {
      width:169px; height:366px;
      position:relative; flex-shrink:0;
    }
    /* Full-size frame, scaled down 45 % */
    .phone-frame {
      width:375px; height:812px;
      transform:scale(0.45); transform-origin:top left;
      position:absolute; top:0; left:0;
      background:#1a1a1e;
      border-radius:54px;
      border:10px solid #2c2c2e;
      box-shadow:
        0 0 0 1px #3a3a3c,
        0 0 0 2px #111,
        inset 0 0 0 1px rgba(255,255,255,.04),
        0 40px 100px rgba(0,0,0,.95),
        0 0 60px rgba(252,238,10,.06);
      overflow:hidden;
    }
    /* Power button (right) */
    .phone-frame::before {
      content:''; position:absolute;
      right:-13px; top:120px;
      width:4px; height:68px;
      background:#3a3a3c; border-radius:0 3px 3px 0;
    }
    /* Volume buttons (left) */
    .phone-frame::after {
      content:''; position:absolute;
      left:-13px; top:90px;
      width:4px; height:36px;
      background:#3a3a3c; border-radius:3px 0 0 3px;
      box-shadow:0 56px 0 #3a3a3c, 0 106px 0 #3a3a3c;
    }
    .phone-screen {
      width:100%; height:100%;
      overflow:hidden; position:relative;
    }
    .phone-screen img {
      width:100%; height:100%;
      object-fit:cover; display:block;
    }
    /* Notch */
    .phone-notch {
      position:absolute; top:0; left:50%;
      transform:translateX(-50%);
      width:154px; height:34px;
      background:#1a1a1e;
      border-radius:0 0 22px 22px;
      z-index:20;
    }
    /* Home bar */
    .phone-home {
      position:absolute; bottom:10px; left:50%;
      transform:translateX(-50%);
      width:120px; height:5px;
      background:rgba(255,255,255,.3); border-radius:3px;
      z-index:20;
    }
    /* Status bar */
    .phone-status {
      position:absolute; top:8px; left:0; right:0;
      display:flex; justify-content:space-between; align-items:center;
      padding:0 28px;
      font-size:13px; font-weight:700;
      color:rgba(255,255,255,.75);
      font-family:-apple-system,sans-serif;
      z-index:15; pointer-events:none;
    }
  `;

  const phoneMarkup = (s) => `
    <div class="phone-slot">
      <div class="tab-label">${esc(s.tab)}</div>
      <div class="phone-wrapper">
        <div class="phone-frame">
          <div class="phone-screen">
            <img src="${esc(s.file)}" alt="${esc(s.tab)}" loading="lazy">
          </div>
          <div class="phone-notch"></div>
          <div class="phone-home"></div>
          <div class="phone-status"><span>9:41</span><span>&#9679;&#9679;&#9679;</span></div>
        </div>
      </div>
    </div>`;

  const commitBlock = (c, idx) => `
  <div class="commit-block">
    <div class="commit-dot"></div>
    <div class="commit-meta">
      <div class="commit-msg">${esc(c.message)}</div>
      <div class="commit-info">${esc(c.hash)} &nbsp;·&nbsp; ${esc(c.date)} &nbsp;·&nbsp; snapshot ${idx + 1}/${metadata.length}</div>
    </div>
    <div class="phones-row">${c.screenshots.map(phoneMarkup).join('')}</div>
  </div>`;

  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>H PROJECT — Interface Evolution</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{
  background:#080d13; color:#fcee0a;
  font-family:'Courier New',monospace;
  padding:48px 32px 80px;
  min-height:100vh;
}
h1{
  text-align:center; font-size:24px;
  letter-spacing:8px; margin-bottom:6px;
  text-shadow:0 0 20px rgba(252,238,10,.4);
}
.subtitle{
  text-align:center; font-size:10px;
  letter-spacing:4px; color:rgba(252,238,10,.4);
  margin-bottom:64px;
}
.timeline{
  max-width:900px; margin:0 auto;
  border-left:2px solid rgba(252,238,10,.15);
  padding-left:32px;
}
.commit-block{
  margin-bottom:64px;
  position:relative;
}
.commit-dot{
  position:absolute; left:-40px; top:4px;
  width:10px; height:10px;
  background:#fcee0a; border-radius:50%;
  box-shadow:0 0 10px rgba(252,238,10,.6);
}
.commit-meta{ margin-bottom:18px; }
.commit-msg{
  font-size:13px; letter-spacing:1px;
  color:#fcee0a; margin-bottom:5px;
  line-height:1.4;
}
.commit-info{
  font-size:10px; letter-spacing:2px;
  color:rgba(0,216,236,.55);
}
.phones-row{
  display:flex; gap:20px; flex-wrap:wrap;
}
${phoneCSS}
</style>
</head>
<body>
<h1>H PROJECT</h1>
<div class="subtitle">INTERFACE EVOLUTION &nbsp;—&nbsp; ${metadata.length} SNAPSHOTS &nbsp;·&nbsp; iPhone 13 mini</div>
<div class="timeline">
${metadata.map(commitBlock).join('')}
</div>
</body>
</html>`;
}

main().catch(err => {
  console.error('\n✗ Fatal:', err.message);
  process.exit(1);
});
