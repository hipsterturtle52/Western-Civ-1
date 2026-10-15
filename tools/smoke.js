// Smoke test: load every route, collect console errors, optional screenshots.
const { chromium } = require('playwright');
const path = require('path');
const file = 'file://' + path.resolve(__dirname, '../clep-western-civilization-i-study-guide.html');
const shots = process.argv[2];
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1200, height: 900 } });
  const errs = [];
  p.on('pageerror', e => errs.push('pageerror: ' + e.message));
  p.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
  p.on('dialog', d => d.accept());
  const routes = ['', 'diagnostic', 'unit/ne', 'unit/ne/quiz', 'cards', 'mistakes', 'exam/1', 'cheatsheet', 'plan', 'progress', 'about'];
  for (const r of routes) {
    await p.goto(file + '#/' + r);
    await p.waitForTimeout(150);
    const txt = await p.$eval('#view', e => e.innerText.slice(0, 80).replace(/\n/g, ' | '));
    console.log((r || 'home').padEnd(14), txt);
    if (shots) await p.screenshot({ path: path.join(shots, (r || 'home').replace(/\//g, '_') + '.png'), fullPage: false });
  }
  console.log(errs.length ? errs.join('\n') : 'no errors');
  await b.close();
})();
