// End-to-end: diagnostic, unit quiz, practice exam (answers via keyboard), flashcards, mistakes, plan, export.
const { chromium } = require('playwright');
const path = require('path');
const file = 'file://' + path.resolve(__dirname, '../clep-western-civilization-i-study-guide.html');
const shots = process.argv[2] || null;
const snap = async (p, n) => { if (shots) await p.screenshot({ path: path.join(shots, n + '.png') }); };
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1200, height: 900 } });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  p.on('dialog', d => d.accept());
  await p.goto(file + '#/diagnostic');
  await p.click('text=Start diagnostic');
  // answer every diagnostic question with key "1"+(i%5) then Enter
  for (let i = 0; i < 30; i++) { await p.keyboard.press(String(1 + (i % 5))); await p.keyboard.press('Enter'); }
  await snap(p, 'diag-last');
  await p.click('button[data-act=submit]');
  await p.waitForTimeout(100);
  console.log('diag result:', (await p.$eval('.sub', e => e.textContent)));
  await snap(p, 'diag-results');
  // unit quiz via keyboard: always choose correct answer by reading DATA
  await p.goto(file + '#/unit/gr/quiz');
  for (let i = 0; i < 15; i++) {
    const a = await p.evaluate(() => { const t = document.querySelector('.qstem').innerHTML; return DATA.questions.find(q => q.q === t && q.pool === 'quiz').a; });
    await p.keyboard.press(String(a + 1));
    if (i === 0) await snap(p, 'quiz-feedback');
    await p.keyboard.press('Enter');
  }
  console.log('quiz result:', await p.$eval('.stat', e => e.textContent));
  // practice exam 1: answer correctly ~80%
  await p.goto(file + '#/exam/1');
  await p.click('text=Start Practice Exam 1 now');
  await snap(p, 'exam-q1');
  for (let i = 0; i < 120; i++) {
    const a = await p.evaluate(() => { const t = document.querySelector('.qstem').innerHTML; return DATA.questions.find(q => q.q === t && q.pool === 'pe1').a; });
    await p.keyboard.press(String(i % 5 === 0 ? ((a + 1) % 5) + 1 : a + 1));
    await p.keyboard.press('Enter');
  }
  const timer = await p.$eval('#timer', e => e.textContent);
  console.log('timer shows', timer);
  await p.click('button[data-act=submit]');
  await p.waitForTimeout(150);
  console.log('exam result:', await p.$eval('.stat', e => e.textContent), '| hash', await p.evaluate(() => location.hash));
  await snap(p, 'exam-results');
  // timer expiry: start exam 2, rewind startedAt by 91 minutes, reload
  await p.goto(file + '#/exam/2');
  await p.click('text=Start Practice Exam 2 now');
  await p.keyboard.press('3');
  await p.evaluate(() => { const s = JSON.parse(localStorage.getItem('clepWC1.progress.v1')); s.exams[2].cur.startedAt -= 91 * 60000; localStorage.setItem('clepWC1.progress.v1', JSON.stringify(s)); });
  await p.goto(file + '#/');
  await p.reload();
  await p.waitForTimeout(300);
  console.log('after expiry hash', await p.evaluate(() => location.hash), '| auto:', await p.evaluate(() => JSON.parse(localStorage.getItem('clepWC1.progress.v1')).exams[2].attempts.map(a => a.score + '% auto=' + a.auto)));
  // dashboard readiness
  await p.goto(file + '#/');
  console.log('readiness:', await p.$eval('.ready-badge', e => e.textContent));
  await snap(p, 'dashboard');
  // flashcards
  await p.goto(file + '#/cards/ne');
  await p.click('text=Review due + new');
  for (let i = 0; i < 5; i++) { await p.keyboard.press(' '); await p.keyboard.press(i % 2 ? '2' : '1'); }
  await snap(p, 'cards');
  await p.goto(file + '#/cards');
  console.log('cards page:', (await p.$eval('#view', e => e.innerText)).split('\n').slice(2, 9).join(' | '));
  // mistakes
  await p.goto(file + '#/mistakes');
  console.log('mistakes:', await p.$eval('.stat', e => e.textContent));
  await p.click('button[data-act=drill]');
  await p.keyboard.press('1'); await p.keyboard.press('Enter');
  // plan
  await p.goto(file + '#/plan');
  await p.fill('#hpd', '1.5');
  const d = new Date(Date.now() + 20 * 864e5).toISOString().slice(0, 10);
  await p.fill('#edate', d);
  await p.click('button[data-act=gen]');
  console.log('plan:', (await p.$eval('#planOut', e => e.innerText)).split('\n').slice(0, 3).join(' | '));
  await snap(p, 'plan');
  // export
  await p.goto(file + '#/progress');
  const [dl] = await Promise.all([p.waitForEvent('download'), p.click('button[data-act=exp]')]);
  console.log('export file:', dl.suggestedFilename());
  // cheatsheet print page count
  await p.goto(file + '#/cheatsheet');
  await p.emulateMedia({ media: 'print' });
  if (shots) { await p.pdf({ path: path.join(shots, 'cheatsheet.pdf'), format: 'Letter', landscape: true, printBackground: true }); }
  await p.emulateMedia({ media: 'screen' });
  // mobile + dark
  const m = await b.newPage({ viewport: { width: 390, height: 844 }, colorScheme: 'dark' });
  await m.goto(file + '#/unit/ema');
  await m.waitForTimeout(100);
  const overflow = await m.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  console.log('mobile horizontal overflow:', overflow);
  if (shots) await m.screenshot({ path: path.join(shots, 'mobile-unit.png') });
  console.log(errs.length ? 'ERRORS:\n' + errs.join('\n') : 'no errors');
  await b.close();
})();
