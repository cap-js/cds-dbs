// bench/runner.cjs
'use strict';

const { performance } = require('node:perf_hooks');
const fs = require('node:fs');
const path = require('node:path');
const cds = require('@sap/cds');


const cqn4sql = require('../lib/cqn4sql');

// stats in ms
function stats(ms) {
  ms.sort((a, b) => a - b);
  const n = ms.length;
  const min = ms[0];
  const max = ms[n - 1];
  const median = ms[Math.floor(n / 2)];
  const p95 = ms[Math.floor(n * 0.95)];
  const mean = ms.reduce((s, x) => s + x, 0) / n;
  const madArr = ms.map(x => Math.abs(x - median)).sort((a, b) => a - b);
  const mad = madArr[Math.floor(n / 2)];
  return { n, min, max, median, p95, mean, mad };
}

function fmtCSVRow(r) {
  return [
    r.case, r.n,
    r.min.toFixed(3),
    r.max.toFixed(3),
    r.median.toFixed(3),
    r.p95.toFixed(3),
    r.mean.toFixed(3),
    r.mad.toFixed(3),
  ].join(',');
}

function gcSafe() { if (global.gc) global.gc(); }

(async function run() {
  const ITER = Number(process.env.ITER || 50);
  const WARMUP = Number(process.env.WARMUP || 20);
  const OUT = process.env.OUT || 'csv'; // csv|json


  // load CDS model once
  // REVISIT: Maybe it would make sense to reload the model for each case,
  //          e.g. calculated elements may pollute the model
  const modelDir = path.join(__dirname, 'model');
  const model = await cds.load([modelDir]).then(cds.linked);

  // find cases
  const casesDir = path.join(__dirname, 'cases');
  const caseFiles = fs.readdirSync(casesDir).filter(f => /\.(cjs|js)$/.test(f));

  const results = [];

  for (const f of caseFiles) {
    const mod = require(path.join(casesDir, f));
    const label = mod.name || path.basename(f, path.extname(f));

    // this is currently not needed, but may be useful later
    if (typeof mod.setup === 'function') await mod.setup({ cqn4sql, model, cds });

    // warmup
    for (let i = 0; i < WARMUP; i++) {
      const cqn = mod.buildInput({ model, cds });
      cqn4sql(cqn, model);
    }
    gcSafe();

    // timed iterations
    const times = [];
    for (let i = 0; i < ITER; i++) {
      const cqn = mod.buildInput({ model, cds });
      const t0 = performance.now();
      cqn4sql(cqn, model);
      const t1 = performance.now();
      times.push(t1 - t0); // ms float
    }

    // e.g. cleanse any model modifications
    if (typeof mod.teardown === 'function') await mod.teardown();

    const s = stats(times);
    results.push({ case: label, ...s });
    gcSafe();
  }

  if (OUT === 'csv') {
    console.log('case,n,min_ms,max_ms,median_ms,p95_ms,mean_ms,mad_ms');
    for (const r of results) console.log(fmtCSVRow(r));
  } else {
    console.log(JSON.stringify({
      runtime: process.version,
      date: new Date().toISOString(),
      results
    }, null, 2));
  }
})().catch(err => {
  console.error(err);
  process.exit(1);
});
