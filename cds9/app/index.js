const cds = require('../lib')
const { find, path, fs } = cds.utils

const odata = endpoint => endpoint.kind.startsWith('odata')
const metadata = endpoint => odata(endpoint) ? `<span>/</span> <a href="${endpoint.path}/$metadata"><span>$metadata</span></a>` : ``
const asHtmlId = s => s.replace(/[.:/$&?@]/g, '_').toLowerCase()

module.exports = { get html(){

  let css = fs.readFileSync(path.join(__dirname,'index.css'),'utf-8')
  let html = fs.readFileSync(path.join(__dirname,'index.html'),'utf-8')
  // .replace ('{{subtitle}}', 'Version ' + cds.version)
  .replace (/{{package}}/g, _project())
  .replace (/{{app}}/g, cds.env.folders.app.replace(/*trailing slash*/ /\/$/, ''))
  .replace ('{{style}}', css)
  .replace ('{{apps}}', _app_links().map(
      html => `<li><a href="${html}"><span>/${html.replace(/^\//,'').replace('/index.html','')}</span></a></li>`
    ).join('\n') || '— none —'
  )
  .replace ('{{services}}', cds.service.providers
  .filter(srv => !srv._is_dark)
  .flatMap(srv => srv.endpoints.map(endpoint => ({srv, endpoint})))
  .map (({srv, endpoint}) => `
      <div id="${asHtmlId(srv.name)}-${endpoint.kind}">
        <h3 class="header">
          <a href="${endpoint.path}"><span>${endpoint.path}</span></a>${metadata(endpoint)} ${_moreLinks(srv, endpoint, undefined, false)}
        </h3>
        <ul>${_entities_in(srv).map (e => `
          <li id="${asHtmlId(srv.name)}-${endpoint.kind}-${asHtmlId(e)}">
            <div>
              <a href="${endpoint.path}/${e.replace(/\./g, '_')}"><span>${e}</span></a>
            </div>
            ${_moreLinks(srv, endpoint, e)}
          </li>`).join('')}
        </ul>
        <ul>${_operations_in(srv).map (e => `
          <li id="${asHtmlId(srv.name)}-${endpoint.kind}-${asHtmlId(e.name)}" class="operation">
            <div>
              <a href="${endpoint.path}/${e.name}" title="${endpoint.path}/${e.name}"><span>${e.name} ${e.params}</span></a>
            </div>
          </li>`).join('')}
        </ul>
      </div>
  `).join(''))

  Object.defineProperty (this,'html',{value:html})
  return html

}}

function _app_links() {
  const folder = path.resolve (cds.root, cds.env.folders.app)
  const files = find (folder, ['*.html', '*/*.html', '*/*/*.html']).map (
    file => path.relative(folder,file).replace (/\\/g,'/')
  )
  return files.concat (cds.app._app_links || [])
}

function _entities_in (service) {
  const exposed=[], {entities} = service
  for (let each in entities) {
    const e = entities [each]
    if (e['@cds.autoexposed'] && !e['@cds.autoexpose'])  continue
    if (/DraftAdministrativeData$/.test(e.name))  continue
    if (/[._]texts$/.test(e.name))  continue
    if (cds.env.effective.odata.containment && service.definition._containedEntities.has(e.name)) continue
    exposed.push (each.replace(/\./g,'_'))
  }
  return exposed
}

function _operations_in (service) {
  const exposed=[], {operations} = service
  for (let name in operations) {
    const op = cds.model.definitions[service.name + '.' + name]
    if (op?.kind === 'function') {
      const params = '('+ Object.keys(op.params||[]) + ')'
      exposed.push ({ name, params })
    }
  }
  return exposed
}

function _moreLinks (srv, endpoint, entity, div=true) {
  return (srv.$linkProviders || [])
    .map (linkProv => linkProv(entity, endpoint))
    .filter (l => l?.href && l?.name)
    // .sort ((l1, l2) => l1.name.localeCompare(l2.name))
    .map (l => `${div?'<div>':'<span>'}<a href="${l.href}"><span class="preview" title="${l.title||l.name}">${l.name}</span></a>${div?'</div>':'</span>'}`)
    .join (' ')
}

function _project(){
  const cwd = cds.root
  try {
    const pj = require(cwd+'/package.json')
    return `${pj.name} ${pj.version}`
  } catch {
    return `${cwd}`
  }
}
