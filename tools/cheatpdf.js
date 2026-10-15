const { chromium } = require('playwright');
const path = require('path');
(async () => {
  const b = await chromium.launch(); const p = await b.newPage();
  await p.goto('file://' + path.resolve(__dirname, '../clep-western-civilization-i-study-guide.html') + '#/cheatsheet');
  await p.emulateMedia({ media: 'print' });
  await p.pdf({ path: process.argv[2], format: 'Letter', landscape: true, printBackground: true, preferCSSPageSize: true });
  await b.close();
})();
