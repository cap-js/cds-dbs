const fs = require('fs')

// source: Expression/Dictionary/csv/collations/collations.csv
// Read collation.csv as collation dictionary
const src = fs.readFileSync(__dirname + '/collations.csv')

// Load collation.wasm binary
const wasmModule = new global.WebAssembly.Module(fs.readFileSync(__dirname + '/collation.wasm'))
// Prepare memory object for parsing
const wasmMemory = new global.WebAssembly.Memory({ initial: Math.ceil(src.length / (1 << 16)) })
// Create wasm instance for execution
const wasmInstance = new global.WebAssembly.Instance(wasmModule, {
  js: {
    mem: wasmMemory,
  },
})
const { extract } = wasmInstance.exports

// Copy collation.csv data into wasm memory
const buf = new Uint8Array(wasmMemory.buffer, 0, wasmMemory.buffer.byteLength)
src.copy(buf, 0, 0, buf.length)

// Parse collation.csv into JSON map
const start = extract(src.length)
const result = Buffer.from(wasmMemory.buffer.slice(start - 1, src.length))
// Add JSON wrapper
result[0] = '{'.charCodeAt(0)
result[result.length - 1] = '}'.charCodeAt(0)

// Validate JSON result
JSON.parse(result)

// Write JSON to lib folder
fs.writeFileSync(__dirname + '/../../lib/collations.json', result)
