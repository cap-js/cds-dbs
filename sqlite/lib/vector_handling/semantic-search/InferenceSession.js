"use strict";
// Copy from onnxruntime-common/dist/cjs/inference-session-impl.js and referenced files by it
// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
// Adjusted to meet the needs of SQLite by making the run functions synchronous to avoid WorkerThreads
const ort = require("onnxruntime-common");
class InferenceSession {
  constructor(handler) {
    this.handler = handler;
  }

  run(feeds) {
    const fetches = {};
    let options = {};
    // check inputs
    if (typeof feeds !== 'object' || feeds === null || feeds instanceof ort.Tensor || Array.isArray(feeds)) {
      throw new TypeError("'feeds' must be an object that use input names as keys and OnnxValue as corresponding values.");
    }
    // check if all inputs are in feed
    for (const name of this.handler.inputNames) {
      if (typeof feeds[name] === 'undefined') throw new Error(`input '${name}' is missing in 'feeds'.`);
    }
    // if no fetches is specified, we use the full output names list
    for (const name of this.handler.outputNames) { fetches[name] = null }
    // feeds, fetches and options are prepared
    const results = this.handler.run(feeds, fetches, options);
    const returnValue = {};
    for (const key in results) {
      if (Object.hasOwnProperty.call(results, key)) {
        const result = results[key];
        if (result instanceof ort.Tensor) returnValue[key] = result;
        else returnValue[key] = new ort.Tensor(result.type, result.data, result.dims);
      }
    }
    return returnValue;
  }

  static async create(arg0) {
    let filePathOrUint8Array;
    if (arg0 instanceof Uint8Array) filePathOrUint8Array = arg0;
    else throw Error('Argument is not supported. Check original InferenceSession implementation if this adjustment needs to be adopted')

    // resolve backend, update session options with validated EPs, and create session handler
    const [backend, optionsWithValidatedEPs] = await resolveBackendAndExecutionProviders();
    const handler = await backend.createInferenceSessionHandler(filePathOrUint8Array, optionsWithValidatedEPs);
    return new InferenceSession(handler);
  }
}
exports.InferenceSession = InferenceSession;


// Copy from onnxruntime-common/dist/cjs/backend-impl.js
async function resolveBackendAndExecutionProviders() {
  const backends = new Map();
  const backendsList = listSupportedBackends();
  for (const backend of backendsList) {
    backends.set(backend.name, { backend: onnxruntimeBackend })
  }
  const backendNames = [...backends.keys()];
  // try to resolve and initialize all requested backends
  let backend;
  const errors = [];
  const availableBackendNames = new Set();
  for (const backendName of backendNames) {
    const resolveResult = await tryResolveAndInitializeBackend(backendName, backends);
    if (typeof resolveResult === 'string') {
      errors.push({ name: backendName, err: resolveResult });
    }
    else {
      if (!backend) {
        backend = resolveResult;
      }
      if (backend === resolveResult) {
        availableBackendNames.add(backendName);
      }
    }
  }
  // if no backend is available, throw error.
  if (!backend) {
    throw new Error(`no available backend found. ERR: ${errors.map((e) => `[${e.name}] ${e.err}`).join(', ')}`);
  }
  return [
    backend,
    new Proxy({}, {
      get: (target, prop) => {
        if (prop === 'executionProviders') {
          return [];
        }
        return Reflect.get(target, prop);
      },
    }),
  ];
};

async function tryResolveAndInitializeBackend(backendName, backends) {
  const backendInfo = backends.get(backendName);
  if (!backendInfo) {
    return 'backend not found.';
  }
  if (backendInfo.initialized) {
    return backendInfo.backend;
  }
  else if (backendInfo.aborted) {
    return backendInfo.error;
  }
  else {
    const isInitializing = !!backendInfo.initPromise;
    try {
      if (!isInitializing) {
        backendInfo.initPromise = backendInfo.backend.init(backendName);
      }
      await backendInfo.initPromise;
      backendInfo.initialized = true;
      return backendInfo.backend;
    }
    catch (e) {
      if (!isInitializing) {
        backendInfo.error = `${e}`;
        backendInfo.aborted = true;
      }
      return backendInfo.error;
    }
    finally {
      delete backendInfo.initPromise;
    }
  }
};

// Copy from test/bookshop/node_modules/onnxruntime-node/dist/backend.js
const binding = require("onnxruntime-node/dist/binding.js");
const dataTypeStrings = [
  undefined,
  'float32',
  'uint8',
  'int8',
  'uint16',
  'int16',
  'int32',
  'int64',
  'string',
  'bool',
  'float16',
  'float64',
  'uint32',
  'uint64',
  undefined,
  undefined,
  undefined,
  undefined,
  undefined,
  undefined,
  undefined,
  'uint4',
  'int4',
];
class OnnxruntimeSessionHandler {
  static inferenceSession = new WeakMap()
  constructor(pathOrBuffer, options) {
    binding.initOrt();
    OnnxruntimeSessionHandler.inferenceSession.set(this, new binding.binding.InferenceSession())
    if (typeof pathOrBuffer === 'string') {
      OnnxruntimeSessionHandler.inferenceSession.get(this).loadModel(pathOrBuffer, options);
    }
    else {
      OnnxruntimeSessionHandler.inferenceSession.get(this).loadModel(pathOrBuffer.buffer, pathOrBuffer.byteOffset, pathOrBuffer.byteLength, options);
    }
    // prepare input/output names and metadata
    this.inputNames = [];
    this.outputNames = [];
    this.inputMetadata = [];
    this.outputMetadata = [];
    // this function takes raw metadata from binding and returns a tuple of the following 2 items:
    // - an array of string representing names
    // - an array of converted InferenceSession.ValueMetadata
    const fillNamesAndMetadata = (rawMetadata) => {
      const names = [];
      const metadata = [];
      for (const m of rawMetadata) {
        names.push(m.name);
        if (!m.isTensor) {
          metadata.push({ name: m.name, isTensor: false });
        }
        else {
          const type = dataTypeStrings[m.type];
          if (type === undefined) {
            throw new Error(`Unsupported data type: ${m.type}`);
          }
          const shape = [];
          for (let i = 0; i < m.shape.length; ++i) {
            const dim = m.shape[i];
            if (dim === -1) {
              shape.push(m.symbolicDimensions[i]);
            }
            else if (dim >= 0) {
              shape.push(dim);
            }
            else {
              throw new Error(`Invalid dimension: ${dim}`);
            }
          }
          metadata.push({
            name: m.name,
            isTensor: m.isTensor,
            type,
            shape,
          });
        }
      }
      return [names, metadata];
    };
    [this.inputNames, this.inputMetadata] = fillNamesAndMetadata(OnnxruntimeSessionHandler.inferenceSession.get(this).inputMetadata);
    [this.outputNames, this.outputMetadata] = fillNamesAndMetadata(OnnxruntimeSessionHandler.inferenceSession.get(this).outputMetadata);
  }
  async dispose() {
    OnnxruntimeSessionHandler.inferenceSession.get(this).dispose();
  }
  run(feeds, fetches, options) {
    return OnnxruntimeSessionHandler.inferenceSession.get(this).run(feeds, fetches, options)
  }
}
class OnnxruntimeBackend {
  init() { }
  createInferenceSessionHandler(pathOrBuffer, options) {
    return new OnnxruntimeSessionHandler(pathOrBuffer, options || {})
  }
}
const onnxruntimeBackend = new OnnxruntimeBackend();
const listSupportedBackends = binding.binding.listSupportedBackends;
