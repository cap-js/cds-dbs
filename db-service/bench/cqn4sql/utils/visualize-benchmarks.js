#!/usr/bin/env node
'use strict'

const fs = require('fs')
const path = require('path')

const dumpPath = process.argv[2] || 'perf-benchmarks.json'
const outPath  = process.argv[3] || 'perf-benchmarks.html'
const metric   = process.argv[4] || 'mean'

if (!fs.existsSync(dumpPath)) {
  console.error(`❌ Cannot find ${dumpPath}`)
  process.exit(1)
}

const dump = JSON.parse(fs.readFileSync(dumpPath, 'utf8'))

// Normalize + sort commits by date (not shown on axis, but used for order)
const entries = Object.entries(dump)
  .map(([commit, v]) => ({
    commit,
    dateISO: v.date,
    date: new Date(v.date),
    benchmarks: v.benchmarks || {}
  }))
  .sort((a, b) => a.date - b.date)

// X-axis: commit IDs (category axis)
const commits = entries.map(e => e.commit)
const commitDates = entries.map(e => e.dateISO)

// Collect all benchmark names across commits
const benchNames = Array.from(
  entries.reduce((s, e) => {
    Object.keys(e.benchmarks).forEach(k => s.add(k))
    return s
  }, new Set())
)

// Build series aligned to commits (null for missing)
const series = benchNames.map(name => {
  const y = entries.map(e => {
    const req = e.benchmarks[name]
    if (!req) return null
    const v = req[metric]
    return typeof v === 'number' ? v : (v != null ? Number(v) : null)
  })
  return { name, x: commits, y }
})

// HTML with Plotly (commit = x, equally spaced)
const html = `<!doctype html>
<html lang="en">
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Perf Benchmarks by Commit</title>
<style>
  :root { --fg:#111; --muted:#666; }
  body { font-family: system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, Arial; margin: 24px; color: var(--fg); }
  h1 { margin: 0 0 8px; font-size: 20px; }
  #chart { width: 100%; height: 72vh; }
  .meta { margin-top: 8px; color: var(--muted); font-size: 12px; }
  label { font-size: 12px; margin-right: 8px; color: var(--muted); }
  select { font-size: 12px; }
</style>
<h1>Perf Benchmarks (requests/second) by Commit</h1>
<div class="meta">
  Data: ${path.basename(dumpPath)} • Commits: ${entries.length} • Metric: requests.${metric}
</div>
<div style="margin:8px 0">
  <label for="filter">Filter benchmark:</label>
  <select id="filter"><option value="__all__">All</option></select>
</div>
<div id="chart"></div>

<script src="https://cdn.plot.ly/plotly-2.35.2.min.js"></script>
<script>
  const SERIES = ${JSON.stringify(series)};
  const COMMITS = ${JSON.stringify(commits)};
  const COMMIT_DATES = ${JSON.stringify(commitDates)};

  // Populate filter
  const filterEl = document.getElementById('filter');
  SERIES.forEach(s => {
    const opt = document.createElement('option');
    opt.value = s.name; opt.textContent = s.name;
    filterEl.appendChild(opt);
  });

  function makeTraces(showName) {
    const base = {
      mode: 'lines+markers',
      connectgaps: false,
      x: COMMITS,
      customdata: COMMIT_DATES, // one per x
      hovertemplate:
        '<b>%{fullData.name}</b><br>' +
        'commit: %{x}<br>' +
        'rps: %{y:.0f}<br>' +
        '%{customdata|%Y-%m-%d %H:%M:%S}<extra></extra>'
    };
    const chosen = showName === '__all__'
      ? SERIES
      : SERIES.filter(s => s.name === showName);
    return chosen.map(s => Object.assign({}, base, { name: s.name, y: s.y }));
  }

  const layout = {
    xaxis: {
      title: 'Commit',
      type: 'category',
      tickangle: -45,
      automargin: true
    },
    yaxis: { title: 'Requests / second', rangemode: 'tozero' },
    hovermode: 'x unified',
    legend: { orientation: 'h' },
    margin: { l: 60, r: 20, t: 10, b: 80 }
  };

  function render() {
    const name = filterEl.value;
    const traces = makeTraces(name);
    Plotly.newPlot('chart', traces, layout, { displayModeBar: true, responsive: true });
  }

  filterEl.addEventListener('change', render);
  render();
</script>
</html>`

fs.writeFileSync(outPath, html, 'utf8')
console.log(`✅ Wrote ${outPath} (${series.length} series, ${entries.length} commits) using requests.${metric}\``)
