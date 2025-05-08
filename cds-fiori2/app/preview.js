const cds = require('@sap/cds')
cds.on('served', ()=>{

  const { app, env: { fiori, preview }, service:{providers} } = cds
  if (!fiori.preview)  return

  const mountPoint = '/$fiori-preview'
  const appID = 'preview-app'
  const _appURL = (srv, entity) => `${mountPoint}/${srv}/${entity}#${appID}`
  const _componentURL = (srv, entity) => `${mountPoint}/${srv}/${entity}/app`
  const isODataEndpoint = endPoint => endPoint.kind.startsWith('odata')
  const findODataEndpoint = srv => srv.endpoints?.find(isODataEndpoint)

  function _manifest(serviceName, entityName) {
    const [serviceProv, serviceInfo] = _validate(serviceName, entityName)
    const endpoint = findODataEndpoint(serviceProv)
    const listPageInitialLoad = fiori.preview.initialload ?? true
    const manifest = {
      _version: '1.8.0',
      'sap.app': {
        id: 'preview',
        type: 'application',
        title: `Preview ‒ List of ${serviceProv.name}.${entityName}`,
        description: 'Preview Application',
        dataSources: {
          mainService: {
            uri: `${endpoint.path}/`,
            type: 'OData',
            settings: {
              odataVersion: '4.0'
            }
          }
        },
      },
      'sap.ui5': {
        flexEnabled: true,
        dependencies: {
          minUI5Version: '1.96.0',
          libs: {
            'sap.ui.core': {},
            'sap.fe.templates': {}
          }
        },
        models: {
          '': {
            dataSource: 'mainService',
            settings: {
              synchronizationMode: 'None',
              operationMode: 'Server',
              autoExpandSelect: true,
              earlyRequests: true,
              groupProperties: {
                default: {
                  submit: 'Auto'
                }
              }
            }
          }
        },
        routing: {
          routes: [
            {
              name: `${entityName}ListRoute`,
              target: `${entityName}ListTarget`,
              pattern: ':?query:',
            },
            {
              name: `${entityName}DetailsRoute`,
              target: `${entityName}DetailsTarget`,
              pattern: `${entityName}({key}):?query:`,
            }
          ],
          targets: {
            [`${entityName}ListTarget`]: {
              type: 'Component',
              id: `${entityName}ListTarget`,
              name: 'sap.fe.templates.ListReport',
              options: {
                settings: {
                  contextPath: `/${entityName}`,
                  initialLoad: listPageInitialLoad,
                  navigation: {
                    [`${entityName}`]: {
                      detail: {
                        route: `${entityName}DetailsRoute`
                      }
                    }
                  }
                }
              }
            },
            [`${entityName}DetailsTarget`]: {
              type: 'Component',
              id: `${entityName}DetailsTarget`,
              name: 'sap.fe.templates.ObjectPage',
              options: {
                settings: {
                  contextPath: `/${entityName}`,
                  navigation: {}
                }
              }
            }
          }
        },
      },
      contentDensities: {
        compact: true,
        cozy: true
      },
      'sap.ui': {
        technology: 'UI5',
        fullWidth: true,
        deviceTypes: {
          desktop: true,
          tablet: true,
          phone: true
        }
      },
      'sap.fiori': {
        registrationIds: [],
        archeType: 'transactional'
      },
    }

    const { routing } = manifest['sap.ui5']
    for (const {navProperty} of serviceInfo) {
      // add a route for the navigation property
      routing.routes.push(
        {
          name: `${navProperty}Route`,
          target: `${navProperty}Target`,
          pattern: `${entityName}({key})/${navProperty}({key2}):?query:`,
        }
      )
      // add a route target leading to the target entity
      routing.targets[`${navProperty}Target`] = {
        type: 'Component',
        id: `${navProperty}Target`,
        name: 'sap.fe.templates.ObjectPage',
        options: {
          settings: {
            contextPath: '/' + entityName + '/' + navProperty
          }
        }
      }
      // wire the new route from the source entity's navigation (see above)
      routing.targets[`${entityName}DetailsTarget`].options.settings.navigation[navProperty] = {
        detail: {
          route: `${navProperty}Route`
        }
      }
    }

    return manifest
  }

  function _html(serviceName, entityName) {
    _validate(serviceName, entityName)
    let ui5Version = fiori.preview.ui5?.version || preview?.fiori?.ui5?.version || ''
    let ui5Host = fiori.preview.ui5?.host || `https://sapui5.hana.ondemand.com/${ui5Version}`
    if (!ui5Host.endsWith('/'))  ui5Host += '/'
    const { theme  } = fiori.preview.ui5

    // copied from UI5's test-resources/sap/ushell/shells/sandbox/fioriSandbox.html
    return `
  <!DOCTYPE html>
  <html>
  <head>
      <meta http-equiv="X-UA-Compatible" content="IE=edge" />
      <meta http-equiv="Content-Type" content="text/html;charset=UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>Preview for ${serviceName}.${entityName}</title>
      <script>
        window["sap-ushell-config"] = {
          defaultRenderer: "fiori2",
          applications: {
            "${appID}": {
              title: "Browse ${entityName}",
              description: "from ${serviceName}",
              additionalInformation: "SAPUI5.Component=app",
              applicationType : "URL",
              url: "${_componentURL(serviceName, entityName)}",
              navigationMode: "embedded"
            }
          }
        }
      </script>
      <script id="sap-ushell-bootstrap" src="${ui5Host}test-resources/sap/ushell/bootstrap/sandbox.js"></script>
      <script id="sap-ui-bootstrap" src="${ui5Host}resources/sap-ui-core.js"
      data-sap-ui-oninit="module:sap/ui/core/ComponentSupport"
      data-sap-ui-compatVersion="edge"
      data-sap-ui-async="true"
      data-sap-ui-preload="async"></script>
      <script>
        function setTheme(dark) { sap.ui.getCore().applyTheme(dark ? "${theme.dark}" : "${theme.light}"); }
        const colorMatcher = window.matchMedia('(prefers-color-scheme: dark)')
        setTheme(colorMatcher.matches)
        ${theme.switch} && colorMatcher.addEventListener("change", e => setTheme(e.matches));

        sap.ui.getCore().attachInit(function() { sap.ushell.Container.createRenderer().placeAt("content") })
      </script>
  </head>
  <body class="sapUiBody sapUiSizeCompact" id="content"></body>
  </html>
  `
  }

  function _componentJs(serviceName, entityName) {
    const manifest = _manifest(serviceName, entityName)
    return `sap.ui.define(["sap/fe/core/AppComponent"], function(AppComponent) {
      "use strict";
      return AppComponent.extend("preview.Component", {
        metadata: { manifest: ${JSON.stringify(manifest, null, 2)} }
      });
    });`
  }

  function _validate(serviceName, entityName) {
    const serviceProv = providers.find (s => s.name === serviceName)
    if (!serviceProv)  throw _badRequest (`No such service '${serviceName}'. Available: [${providers.map(p => p.name)}]`)
    const odata = findODataEndpoint(serviceProv)
    if (!odata)  throw _badRequest (`Not an OData service: ${serviceName}`)
    return _serviceInfo (serviceProv, entityName)
  }

  function _serviceInfo (serviceProv, entityName) {
    const entities = serviceProv.model.entities(serviceProv.name)
    const entity = entities[entityName]
    if (!entity)  throw _badRequest (`No such entity '${entityName}' in service '${serviceProv.name}'`)
    return [serviceProv, serviceProv.model.all ('Association', entity.elements)
      .filter (a =>
          !a.target.endsWith('.texts') &&
          !a.target.endsWith('_texts') &&
          !a.target.endsWith('DraftAdministrativeData') &&
          a.name !== 'SiblingEntity')
      .map (a => { return { navProperty: a.name, targetEntity: a.target.split('.')[1] } })
    ]
  }

  const _badRequest = (message) => { const err = new Error (message); err.statusCode = 400; return err}


  // fetch and instrument all OData providers
  const any = providers.filter (srv => !!findODataEndpoint(srv))
  .map(srv => {
    // called from ../index.js to provide the data for the HTML link
    const link = linkProvider(srv)
    srv.$linkProviders ? srv.$linkProviders.push (link) : srv.$linkProviders = [link]
    return link
  })
  .length


  // install middlewares once
  if (any) {
    const router = require('express').Router()
    // UI5 component
    router.get ('/:service/:entity/app/Component.js', ({ params }, resp) => resp.send(_componentJs(params.service, params.entity)))
    // html
    router.get ('/:service/:entity', ({ params }, resp, next) => {
      if (params.entity === 'fioriSandboxConfig.json')  return next() // Fiori sends this, skip over it
      resp.send(_html(params.service, params.entity))
    })

    app.use(mountPoint.replace('$','\\$'), router)
  }

  function linkProvider(service) {
    return (entity, endpoint) => {
      if (!entity || (endpoint && !isODataEndpoint(endpoint)))  return
      return {
        href: _appURL(service.name, entity),
        title: 'Preview in Fiori elements',
        name: 'Fiori preview'
      }
    }
  }

})
