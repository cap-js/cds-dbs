#!/usr/bin/env node
'use strict'

const fs = require('fs')
const path = require('path')

const dumpPath = process.argv[2] || 'results/cqn4sql-benchmarks.json'
const outPath  = process.argv[3] || 'dist/index.html'

if (!fs.existsSync(dumpPath)) {
  // eslint-disable-next-line no-console
  console.error(`❌ Cannot find ${dumpPath}`)
  process.exit(1)
}

const dump = JSON.parse(fs.readFileSync(dumpPath, 'utf8'))

// normalize + sort by date
const entries = Object.entries(dump)
  .map(([commit, v]) => ({ commit, dateISO: v.date, date: new Date(v.date), benchmarks: v.benchmarks || {} }))
  .sort((a, b) => a.date - b.date)

const commits = entries.map(e => e.commit)
const commitDates = entries.map(e => e.dateISO)
const commitLabels = commits.map((sha, i) => {
  const d = new Date(commitDates[i])
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return `${sha} (${y}-${m}-${day})`
})


// collect benchmark names
const benchNames = Array.from(
  entries.reduce((s, e) => {
    Object.keys(e.benchmarks).forEach(k => s.add(k))
    return s
  }, new Set())
).sort()

// collect available metric keys (union across all benches/commits)
const metricSet = new Set()
for (const e of entries) {
  for (const name of Object.keys(e.benchmarks)) {
    const obj = e.benchmarks[name]
    Object.keys(obj || {}).forEach(k => metricSet.add(k))
  }
}

const metrics = ['mean', 'stddev', 'total', 'p50', 'p90', 'p99', 'min', 'max']
const initialMetric = 'mean'

// precompute all series data per metric to keep UI snappy
function buildSeriesForMetric(metric) {
  return benchNames.map(name => {
    const y = entries.map(e => {
      const obj = e.benchmarks[name]
      if (!obj) return null
      const v = obj[metric]
      return (typeof v === 'number') ? v : (v != null ? Number(v) : null)
    })
    return { name, x: commits, y }
  })
}

const allSeries = {}
for (const m of metrics) allSeries[m] = buildSeriesForMetric(m)

// HTML (commit categories on X, metric selector, benchmark filter)
const html = `<!doctype html>
<html lang="en">
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>CQN4SQL Benchmarks</title>
<style>
  :root { --fg:#111; --muted:#666; }
  body { font-family: system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, Arial; margin: 24px; color: var(--fg); }
  h1 { margin: 0 0 8px; font-size: 20px; }
  #chart { width: 100%; height: 72vh; }
  .meta { margin: 6px 0 12px; color: var(--muted); font-size: 12px; }
  label { font-size: 12px; margin-right: 6px; color: var(--muted); }
  select { font-size: 12px; margin-right: 12px; }
</style>

<h1>CQN4SQL Benchmarks</h1>
<div class="meta">
  Data: ${path.basename(dumpPath)} • Commits: ${entries.length}
  <br>
  Measurements in requests per second (higher is better)
</div>

<div>
  <label for="metric">Metric:</label>
  <select id="metric"></select>

  <label for="bench">Benchmark:</label>
  <select id="bench"><option value="__all__">All</option></select>
</div>

<div id="chart"></div>

<script src="https://cdn.plot.ly/plotly-2.35.2.min.js"></script>
<script>
  const COMMITS = ${JSON.stringify(commits)};
  const COMMIT_DATES = ${JSON.stringify(commitDates)};
    // labels like: <sha> (YYYY-MM-DD)
  const COMMIT_LABELS = ${JSON.stringify(commitLabels)};
  const METRICS = ${JSON.stringify(metrics)};
  const INITIAL_METRIC = ${JSON.stringify(initialMetric)};
  const BENCH_NAMES = ${JSON.stringify(benchNames)};
  const ALL_SERIES = ${JSON.stringify(allSeries)};

  const metricEl = document.getElementById('metric');
  METRICS.forEach(m => {
    const opt = document.createElement('option');
    opt.value = m; opt.textContent = m;
    if (m === INITIAL_METRIC) opt.selected = true;
    metricEl.appendChild(opt);
  });

  const benchEl = document.getElementById('bench');
  BENCH_NAMES.forEach(n => {
    const opt = document.createElement('option');
    opt.value = n; opt.textContent = n;
    benchEl.appendChild(opt);
  });

  function tracesFor(metric, benchName) {
    const base = {
      mode: 'lines+markers',
      connectgaps: false,
      x: COMMITS,
      customdata: COMMIT_DATES,
      hovertemplate:
        '<b>%{fullData.name}</b><br>' +
        'commit: %{x}<br>' +
        'value: %{y:.0f}<br>' +
        '%{customdata|%Y-%m-%d %H:%M:%S}<extra></extra>'
    };
    const series = ALL_SERIES[metric] || [];
    const chosen = benchName === '__all__' ? series : series.filter(s => s.name === benchName);
    return chosen.map(s => Object.assign({}, base, { name: s.name, y: s.y }));
  }

  const layout = {
    xaxis: { title: 'Commit', tickvals: COMMITS, ticktext: COMMIT_LABELS, type: 'category', tickangle: -45, automargin: true },
    yaxis: { title: 'Requests / second', rangemode: 'tozero' },
    hovermode: 'x unified',
    legend: { orientation: 'h' },
    margin: { l: 60, r: 20, t: 10, b: 80 }
  };

  function render() {
    const m = metricEl.value;
    const b = benchEl.value;
    const traces = tracesFor(m, b);
    const l = Object.assign({}, layout, { yaxis: Object.assign({}, layout.yaxis, { title: 'Requests / second ('+m+')' }) });
    Plotly.newPlot('chart', traces, l, { displayModeBar: true, responsive: true });
  }

  metricEl.addEventListener('change', render);
  benchEl.addEventListener('change', render);
  render();
</script>
</html>`

fs.mkdirSync(path.dirname(outPath), { recursive: true })
fs.writeFileSync(outPath, html, 'utf8')
// eslint-disable-next-line no-console
console.log(`✅ wrote ${outPath} — metrics: [${metrics.join(', ')}], benches: ${benchNames.length}, commits: ${entries.length}`)
