const fs = require('fs')
const path = require('path')
const hana = require('./hana')

const allDates = []
for (let year = 1970; year < 9999; year++) {
  const start = new Date(year + '')
  const end = new Date(year + 1 + '')
  let day = 2
  allDates.push(start)
  while (allDates[allDates.length - 1] < end) {
    const cur = new Date(start)
    cur.setDate(day++)
    allDates.push(cur)
  }
}

let seed = 1
const next = function (i) {
  seed = (seed << 5) - seed + i
  return (seed >>> 0) % allDates.length
}
for (let i = 0; i < 10; i++) next(i)

const csv = fs.createWriteStream(path.resolve(__dirname, '../../data/edge.hana.functions-timestamps.csv'))
csv.on('ready', async () => {
  try {
    const columns = ['a', 'b', 'years', 'months', 'days', 'seconds', 'nano100']
    const funcs = {
      a: () => `'${allDates[next(1)].toISOString()}'`,
      b: () => `'${allDates[next(1)].toISOString()}'`,
      years: () => 'YEARS_BETWEEN(:a,:b)',
      months: () => 'MONTHS_BETWEEN(:a,:b)',
      days: () => 'DAYS_BETWEEN(:a,:b)',
      seconds: () => 'SECONDS_BETWEEN(:a,:b)',
      nano100: () => 'NANO100_BETWEEN(:a,:b)',
    }
    csv.write(columns.join(';'))
    csv.write('\n')
    for (let i = 0; i < 1000; i++) {
      const vals = columns.map(n => funcs[n]())
      const sql = `SELECT ${vals.map((c, i) => `${c} AS "${columns[i]}"`).join(',')} FROM DUMMY`.replace(
        /:(\D)/g,
        (_, n) => vals[columns.indexOf(n)],
      )
      const res = (await hana(sql))[0]
      csv.write(columns.map(c => res[c]).join(';'))
      csv.write('\n')
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error(e.stack)
    process.exit(1)
  }
  csv.close()
})

csv.on('close', () => process.exit())
