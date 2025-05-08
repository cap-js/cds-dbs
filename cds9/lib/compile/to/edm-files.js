const { Worker, parentPort, isMainThread, workerData } = require('node:worker_threads')
const cds = require('../../index.js'), { path, local, read, exists } = cds.utils
const TRACE = cds.debug('trace')
const LOG = cds.log('cds|edmx')
const OUT = process.env.cds_test_temp || path.join (cds.root,'_out')

// -----------------------------------------------------------------------
//
//   Main Thread Part
//

if (isMainThread) {

  module.exports = exports = (csn, tenant, features) => {
    const defs = Object.entries(csn.definitions), protocols = cds.service.protocols
    const services = defs.filter(([,d]) => d.kind === 'service' && 'odata' in protocols.for(d)).map(([k]) => k)
    if (!services.length) return LOG.debug (`No service definitions found in given model(s).`)
    let dir = path.join (OUT, tenant||'', features||'')
    LOG.info ('generating edmx files to', { dir: local(dir) }, '\n')
    return GENERATE ({ csn, dir, services })
  }

  const GENERATE = _generate_using_workers // for running in worker threads
  // const GENERATE = _generate_edmxs      // for running in main thread

  async function _generate_using_workers (workerData) {
    await new Promise((resolve, reject) => new Worker (__filename, { workerData })
    .on('error', reject)
    .on('message', msg => {
      if (msg.error) return reject (new cds.error(msg.error))
      if (msg === 'done') return resolve()
      else LOG.debug (msg)
    }))
    exports.get = _read_generated_edmx4
  }

  function _read_generated_edmx4 (srv, kind='edmx', { tenant, features }={}) {
    let dir = path.join (OUT, tenant||'', features||'')
    let file = path.join (dir, srv.definition.name+'.'+kind)
    if (!exists(file)) throw new Error (`No generated edm(x) file found at: ${file}`)
    return read (file)
  }

  exports.dir = OUT
}



// -----------------------------------------------------------------------
//
//   Worker Thread Part
//


if (!isMainThread) _generate_edmxs (workerData)
.catch (e => parentPort.postMessage({ error: e }))
.then (() => parentPort.postMessage('done'))


async function _generate_edmxs ({ csn, dir, services }) {

  const { mkdir, writeFile } = cds.utils.fs.promises
  await mkdir (dir, { recursive: true })
  const cdsc = cds.compiler
  const todos = []

  TRACE?.time(`cdsc.generate edmxs`.padEnd(22))

  // generate .edmx files only
  let result = cdsc.to.edmx.all (csn, { serviceNames: services, messages:[] })
  for (let [name,edmx] of Object.entries(result)) {
    todos.push ({ file: name + '.edmx', content: edmx })
  }

  await Promise.all (todos.map (({file,content}) => writeFile (path.join(dir,file), content)
    .then (() => parentPort?.postMessage ({ generated: local(file) }))
  ))
  TRACE?.timeEnd(`cdsc.generate edmxs`.padEnd(22))
  return true
}
