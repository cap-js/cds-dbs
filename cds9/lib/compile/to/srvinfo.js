
const cds = require('../..')
const { isfile, path: { join } } = cds.utils

// Produces information on provided services in the model:
//   name, expected URL path at runtime,...
module.exports = (model, options={}) => {

  const result = []
  const isNodeProject = _isNodeProject(options.root || cds.root)
  const javaPrefix = _javaPrefix(options.root || cds.root)
  const isJavaProject = !!javaPrefix

  cds.linked(model) .all ('service')
    .filter(service => service['@protocol'] !== 'none') // 'none' means internal service
    .forEach (service => {
      if (isJavaProject) {
        result.push(_makeJava(service))
        if (isNodeProject) {  // could be a node project as well (hybrid)
          result.push(_makeNode(service))
        }
      }
      else { // assume this is node
        result.push(_makeNode(service))
      }
    }
  )

  return result

  function _makeJava(service) {
    // use first endpoint, preferably odata
    // TODO handle multiple protocols for java, see https://cap.cloud.sap/docs/java/application-services#serve-configuration
    const kind = Object.keys(service.protocols).find(k => k.startsWith('odata')) || Object.keys(service.protocols)[0]
    const endpoints = [{ kind, path: _url4(_javaPath(service)) }]
    return {
      name: service.name,
      urlPath: endpoints[0].path, // legacy
      destination: 'srv-api', // the name to register in xs-app.json
      endpoints,
      runtime: 'Java',
      location: service.$location
    }
  }
  function _makeNode(service) {
    // make a fake runtime object for the service, adding a `definition` property
    if (!service.definition)  Object.defineProperty(service, 'definition', { value: service, enumerable: false })
    const endpoints = cds.service.protocols.endpoints4(service).map?.(e => Object.assign({}, e, { path: _url4(e.path) }))
    return {
      name: service.name,
      destination: 'srv-api', // the name to register in xs-app.json
      runtime: 'Node.js',
      location: service.$location,
      ...endpoints?.[0] && {
        urlPath: endpoints[0].path, // legacy
        endpoints
      }
    }
  }

   // the URL path that is *likely* effective at runtime
  function _url4 (p) {
    if (p) {
      p = p.replace(/\\/g, '/') // handle Windows
           .replace(/^\/+/, '') // strip leading
           .replace(/\/+$/, '') // strip trailing
      if (!p.endsWith('/'))  p += '/' // end with /
      return p
    }
  }

  function _javaPath (service) {
    const d = model.definitions[service.name]
    const path = d && d['@path'] ? d['@path'].replace(/^[^/]/, c => '/'+c) : service.name
    return join(javaPrefix, path)
  }

  function _isNodeProject(root) {
    for (let dir of [root, join(root, cds.env.folders.srv)]) {
      const file = isfile (join (dir,'package.json'))
      if (file) {
        const pjson = require(file)
        if (pjson.dependencies && pjson.dependencies['@sap/cds']) {
          return true
        }
      }
    }
  }

  function _javaPrefix(root) {
    let is_java
    const javaPrefixDefault = 'odata/v4/'
    const roots = [ cds.env.folders.db, cds.env.folders.srv ].map(d => join(root, d))
    for (let r of roots) {
      const file = isfile (join (r,'./src/main/resources/application.yaml'))
      if (file) {
        const yaml = cds.load.yaml(file)
        for (let yamlDoc of Array.isArray(yaml) ? yaml : [yaml]) {
          let cds = yamlDoc?.cds;
          if (!cds)   continue
          cds = _normalizeSpringBootCfg(cds)
          // https://cap.cloud.sap/docs/java/application-services#configure-base-path
          return cds.odataV4?.endpoint?.path || cds.odataV2?.endpoint?.path
              || cds['odata-v4']?.endpoint?.path || cds['odata-v2']?.endpoint?.path // alternative config
              || javaPrefixDefault
        }
        return javaPrefixDefault
      }
      else if (isfile (join(r,'../pom.xml'))) is_java = true
    }
    return is_java && javaPrefixDefault
  }

  // SpringBoot allows dots in keys to express nested objects, so we need to split them
  function _normalizeSpringBootCfg(obj) {
    if (typeof obj !== 'object')  return obj
    Object.keys(obj).forEach(k => {
      const prop = k.split('.')
      const last = prop.pop()
      // and define the object if not already defined
      const res = prop.reduce((o, key) => {
        // define the object if not defined and return
        return o[key] = o[key] ?? {}
      }, obj)
      res[last] = obj[k]
      // recursively normalize
      _normalizeSpringBootCfg(obj[k])
      // delete the original property from object if it was rewritten
      if (prop.length)  delete obj[k]
    })
    return obj
  }

}
