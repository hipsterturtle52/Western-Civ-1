// Self-audit of the built study guide. Run: node tools/audit.js
// 1) structural checks on every question (5 options, exactly one correct, explanation per option, unit tag)
// 2) pool integrity (diag / quiz / pe1 / pe2 disjoint, correct sizes, per-unit counts match outline plan)
// 3) simulated diagnostic + practice exams scored in code (all-correct must be 100%, all-wrong 0%)
// 4) content-coverage check: proper nouns / years in each correct answer must appear in the lesson material
// Writes AUDIT.md and exits non-zero on any structural failure.
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.resolve(__dirname, '../clep-western-civilization-i-study-guide.html'), 'utf8');
const m = html.match(/const DATA = (\{[\s\S]*?\});\nconst U = /);
if (!m) { console.error('DATA not found'); process.exit(1); }
const DATA = JSON.parse(m[1].replace(/<\\\//g, '</'));
const U = DATA.units, Q = DATA.questions, plan = DATA.outline.unit_plan.units;
const UBY = Object.fromEntries(U.map(u => [u.id, u]));
const fails = [], warns = [];
const strip = s => s.replace(/<[^>]+>/g, '').replace(/&[a-z]+;/g, ' ');

// ---- 1. structural checks
const ids = new Set();
for (const q of Q) {
  const tag = `${q.id}`;
  if (ids.has(q.id)) fails.push(`${tag}: duplicate id`); ids.add(q.id);
  if (!UBY[q.u]) fails.push(`${tag}: bad unit tag ${q.u}`);
  if (!['e', 'm', 'h'].includes(q.d)) fails.push(`${tag}: bad difficulty`);
  if (!['diag', 'quiz', 'pe1', 'pe2'].includes(q.pool)) fails.push(`${tag}: bad pool`);
  if (!q.q || strip(q.q).trim().length < 10) fails.push(`${tag}: empty stem`);
  if (!Array.isArray(q.o) || q.o.length !== 5) fails.push(`${tag}: needs 5 options`);
  if (!(Number.isInteger(q.a) && q.a >= 0 && q.a < 5)) fails.push(`${tag}: answer index invalid`);
  if (!Array.isArray(q.w) || q.w.length !== 5 || q.w.some(w => !w || strip(w).trim().length < 8)) fails.push(`${tag}: missing explanation for an option`);
  if (new Set(q.o.map(o => strip(o).toLowerCase().trim())).size !== 5) fails.push(`${tag}: duplicate option text`);
  if (q.o.some(o => /all of the above|none of the above/i.test(o))) fails.push(`${tag}: all/none of the above`);
  if (q.w.some(w => /\b(option|choice|answer) [A-E]\b/.test(strip(w)))) warns.push(`${tag}: explanation refers to a letter`);
}
// exactly one correct is guaranteed by a single integer index; verify the source marked exactly one "+" too
for (const f of fs.readdirSync(path.resolve(__dirname, '../src/questions'))) {
  const t = fs.readFileSync(path.resolve(__dirname, '../src/questions', f), 'utf8');
  t.split(/\n\s*\n(?=Q )/).forEach((b, i) => {
    const plus = (b.match(/^\+ /gm) || []).length, minus = (b.match(/^- /gm) || []).length;
    if (plus !== 1 || minus !== 4) fails.push(`${f} block ${i + 1}: ${plus} correct / ${minus} wrong options`);
  });
}

// ---- 2. pools
const pools = { diag: [], quiz: [], pe1: [], pe2: [] };
Q.forEach(q => pools[q.pool].push(q));
const need = { diag: 'diag', quiz: 'quiz', pe1: 'exam_each', pe2: 'exam_each' };
for (const [pool, key] of Object.entries(need)) {
  for (const p of plan) {
    const n = pools[pool].filter(q => q.u === p.id).length;
    if (n !== p[key]) fails.push(`pool ${pool}: unit ${p.id} has ${n}, plan says ${p[key]}`);
  }
}
for (const pool of ['diag', 'pe1', 'pe2']) {
  const order = DATA.pools[pool];
  if (new Set(order).size !== order.length) fails.push(`${pool}: repeated question in exam order`);
  if (order.length !== pools[pool].length) fails.push(`${pool}: order length mismatch`);
  if (order.some(id => !Q.find(q => q.id === id && q.pool === pool))) fails.push(`${pool}: order contains foreign question`);
}
const overlap = (a, b) => DATA.pools[a].filter(id => DATA.pools[b].includes(id)).length;
if (overlap('pe1', 'pe2') || overlap('pe1', 'diag') || overlap('pe2', 'diag')) fails.push('exam pools overlap');
const quizIds = new Set(pools.quiz.map(q => q.id));
if (DATA.pools.pe1.concat(DATA.pools.pe2, DATA.pools.diag).some(id => quizIds.has(id))) fails.push('an exam repeats a quiz question');
if (DATA.pools.pe1.length !== 120 || DATA.pools.pe2.length !== 120) fails.push('practice exams must have 120 questions');

// ---- 3. simulate diagnostic + practice exams in code
function score(poolName, pick) {
  const qs = DATA.pools[poolName].map(id => Q.find(q => q.id === id));
  const ans = Object.fromEntries(qs.map(q => [q.id, pick(q)]));
  const by = {};
  qs.forEach(q => { const b = by[q.u] || (by[q.u] = { n: 0, c: 0 }); b.n++; if (ans[q.id] === q.a) b.c++; });
  const c = qs.filter(q => ans[q.id] === q.a).length;
  return { pct: Math.round(100 * c / qs.length), by, n: qs.length };
}
const sims = {};
for (const pool of ['diag', 'pe1', 'pe2']) {
  const right = score(pool, q => q.a), wrong = score(pool, q => (q.a + 1) % 5);
  let rnd = 0; for (let k = 0; k < 200; k++) rnd += score(pool, () => Math.floor(Math.random() * 5)).pct; rnd /= 200;
  if (right.pct !== 100) fails.push(`${pool}: all-correct sheet scored ${right.pct}%`);
  if (wrong.pct !== 0) fails.push(`${pool}: all-wrong sheet scored ${wrong.pct}%`);
  const sameLetter = [0, 1, 2, 3, 4].map(L => score(pool, () => L).pct);
  sims[pool] = { n: right.n, by: right.by, random: rnd, sameLetter };
}

// ---- 4. content coverage: key terms of each correct answer must appear in lesson material
const corpus = {};
for (const u of U) corpus[u.id] = strip([u.lesson, u.mustKnow.join(' '), u.compare, u.timeline.map(t => t.label + ' ' + t.text).join(' '), u.people.map(p => p.name + ' ' + p.desc).join(' '), u.cards.map(c => c.f + ' ' + c.b).join(' ')].join(' ')).toLowerCase();
const all = Object.values(corpus).join(' ');
const STOP = new Set('The A An In Of On And Or To For By With From At As Its It Both Each Only Not No Which What Who When Rome Roman Greek Greeks Europe European Church Christian Christians Christianity Empire Emperor King Kings Pope Spain France England English French German Germany Italy Italian Egypt Egyptian Persia Persian Athens Athenian Sparta Spartan Byzantine Islamic Muslim Muslims Catholic Protestant West Western East Eastern North South BCE CE They He She This That These Those Their His Her'.split(' '));
// items a human reviewed and accepted (reason shown in the report)
const REVIEWED = {
  'ema-q206': 'lesson says Charlemagne was "crowned"; the answer says "Coronation"',
  'rr-q304': 'EXCEPT question; the Edict of Nantes is the deliberate out-of-unit distractor (taught in Unit 7)',
};
const coverage = [];
for (const q of Q) {
  const ans = strip(q.o[q.a]);
  const terms = new Set();
  // capitalized words (skipping the sentence-initial word), possessives stripped
  (ans.match(/\b[A-Z][a-zA-Z'’\-]{3,}\b/g) || []).forEach((t, i) => {
    if (i === 0 && ans.indexOf(t) === 0) return;
    t = t.replace(/['’]s$/, '');
    if (!STOP.has(t)) terms.add(t);
  });
  (ans.match(/\b\d{3,4}\b/g) || []).forEach(t => terms.add(t));
  // match on a stem (first 6 letters) so Copernican ~ Copernicus, Visigothic ~ Visigoths
  const stem = t => t.toLowerCase().slice(0, Math.max(4, Math.min(6, t.length)));
  const miss = [...terms].filter(t => !corpus[q.u].includes(stem(t)));
  const missAll = miss.filter(t => !all.includes(stem(t)));
  if (missAll.length) coverage.push({ id: q.id, u: q.u, terms: missAll, where: 'not in any unit', ans });
  else if (miss.length) coverage.push({ id: q.id, u: q.u, terms: miss, where: 'only in another unit', ans });
}

// ---- report
const tq = Q.length, tc = U.reduce((a, u) => a + u.cards.length, 0), tw = U.reduce((a, u) => a + u.words, 0);
const pos = [0, 0, 0, 0, 0]; Q.forEach(q => pos[q.a]++);
const diffAll = { e: 0, m: 0, h: 0 }; Q.forEach(q => diffAll[q.d]++);
let md = `# Self-audit: CLEP Western Civilization I study guide\n\nGenerated ${new Date().toISOString().slice(0, 10)} by \`node tools/audit.js\`.\n\n`;
md += `## Result\n\n- Structural failures: **${fails.length}**${fails.length ? '\n' + fails.map(f => `  - ${f}`).join('\n') : ''}\n- Warnings: ${warns.length}${warns.length ? '\n' + warns.map(f => `  - ${f}`).join('\n') : ''}\n`;
md += `- Every question checked for: unit tag, difficulty, pool, 5 unique options, exactly one correct option (source has one \`+\` and four \`-\`), an explanation for each of the 5 options, and no all/none-of-the-above.\n\n`;
md += `## Content vs. official weights\n\n| Unit | Official topic (weight) | Target share | Lesson words (~min) | Questions | % of bank | Flashcards | % of cards | Diag / Quiz / PE1 / PE2 | Easy / Med / Hard |\n|---|---|---|---|---|---|---|---|---|---|\n`;
for (const u of U) {
  const uq = Q.filter(q => q.u === u.id), t = DATA.outline.topics.find(t => t.id === u.topic);
  const d = { e: 0, m: 0, h: 0 }; uq.forEach(q => d[q.d]++);
  md += `| ${u.title} | ${t.name} (${t.weight}) | ${u.share.toFixed(1)}% | ${u.words} (~${u.lessonMin}) | ${uq.length} | ${(100 * uq.length / tq).toFixed(1)}% | ${u.cards.length} | ${(100 * u.cards.length / tc).toFixed(1)}% | ${['diag', 'quiz', 'pe1', 'pe2'].map(p => pools[p].filter(q => q.u === u.id).length).join(' / ')} | ${d.e} / ${d.m} / ${d.h} |\n`;
}
md += `| **Total** | | 100% | ${tw} | **${tq}** | | **${tc}** | | ${['diag', 'quiz', 'pe1', 'pe2'].map(p => pools[p].length).join(' / ')} | ${diffAll.e} / ${diffAll.m} / ${diffAll.h} |\n\n`;
md += `Lessons: ${U.length} (one per unit). Difficulty mix: ${(100 * diffAll.e / tq).toFixed(0)}% easy / ${(100 * diffAll.m / tq).toFixed(0)}% medium / ${(100 * diffAll.h / tq).toFixed(0)}% hard (target 30/50/20). Correct-answer positions A–E: ${pos.join(' / ')}.\n\n`;
md += `## Simulated runs (scored in code)\n\n| Test | Questions | All-correct sheet | All-wrong sheet | Random guessing (avg of 200) | Always-same-letter A/B/C/D/E |\n|---|---|---|---|---|---|\n`;
for (const [k, s] of Object.entries(sims)) md += `| ${k} | ${s.n} | 100% | 0% | ${s.random.toFixed(1)}% | ${s.sameLetter.join('% / ')}% |\n`;
md += `\nPer-unit question counts in each simulated test:\n\n| Unit | Diagnostic | Practice Exam 1 | Practice Exam 2 |\n|---|---|---|---|\n`;
for (const u of U) md += `| ${u.title} | ${sims.diag.by[u.id].n} | ${sims.pe1.by[u.id].n} | ${sims.pe2.by[u.id].n} |\n`;
md += `\nNo question appears in more than one of: diagnostic, unit quizzes, Practice Exam 1, Practice Exam 2.\n\n`;
md += `## Content-coverage check\n\nProper nouns and years in each correct answer were searched for in the unit's lesson, must-know box, timeline, people table, comparison tables, and flashcards. ${coverage.length} item(s) flagged for manual review:\n\n`;
md += coverage.length ? coverage.map(c => `- \`${c.id}\` (${c.where}): ${c.terms.join(', ')}. Answer: "${c.ans}"${REVIEWED[c.id] ? ` **Reviewed OK:** ${REVIEWED[c.id]}.` : ' **NEEDS REVIEW**'}`).join('\n') + '\n' : 'None.\n';
fs.writeFileSync(path.resolve(__dirname, '../AUDIT.md'), md);
console.log(md);
process.exit(fails.length ? 1 : 0);
