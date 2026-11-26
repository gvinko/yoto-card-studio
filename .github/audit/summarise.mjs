// Summarise Lighthouse JSON runs: median score per category per form factor + the audits that cost points.
// Usage: node summarise.mjs <dir-with-lh-json>  → writes <dir>/summary.json and prints a table.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2];
const files = readdirSync(dir).filter((f) => /^lh-(mobile|desktop)-\d+\.report\.json$/.test(f));
const byFactor = {};
for (const f of files) {
  const factor = f.split('-')[1];
  const r = JSON.parse(readFileSync(join(dir, f), 'utf8'));
  (byFactor[factor] ||= []).push(r);
}
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
const out = {};
for (const [factor, runs] of Object.entries(byFactor)) {
  const cats = Object.keys(runs[0].categories);
  const scores = {};
  for (const c of cats) scores[c] = Math.round(100 * median(runs.map((r) => r.categories[c].score ?? 0)));
  // Failing audits from the run closest to the median performance score.
  const perfMed = median(runs.map((r) => r.categories.performance?.score ?? 0));
  const rep = runs.find((r) => (r.categories.performance?.score ?? 0) === perfMed) || runs[0];
  const failing = {};
  for (const c of cats) {
    failing[c] = rep.categories[c].auditRefs
      .filter((a) => a.weight > 0)
      .map((a) => ({ id: a.id, weight: a.weight, score: rep.audits[a.id].score, display: rep.audits[a.id].displayValue || '' }))
      .filter((a) => a.score !== null && a.score < 1)
      .sort((a, b) => b.weight * (1 - b.score) - a.weight * (1 - a.score));
  }
  const metrics = {};
  for (const id of ['first-contentful-paint', 'largest-contentful-paint', 'total-blocking-time', 'cumulative-layout-shift', 'speed-index']) {
    if (rep.audits[id]) metrics[id] = rep.audits[id].displayValue;
  }
  const errors = rep.runtimeError ? rep.runtimeError.message : null;
  out[factor] = { runs: runs.length, scores, metrics, failing, finalUrl: rep.finalDisplayedUrl, runtimeError: errors };
}
writeFileSync(join(dir, 'summary.json'), JSON.stringify(out, null, 2));
for (const [f, v] of Object.entries(out)) console.log(f.padEnd(8), JSON.stringify(v.scores));
