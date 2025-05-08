const _runtime = '@sap/cds/libx/_runtime'

exports = module.exports = {

  middlewares: true, // REVISIT: odata-v2-adapter uses this
  db: undefined,            "[schevo]": { db: { schema_evolution: 'auto' }, },
  messaging: undefined,
  multitenancy: undefined,
  extensibility: undefined,
  toggles: undefined,
  queue: true,

  auth: {
    '[development]': { kind: 'mocked-auth' },
    '[production]': { kind: 'jwt-auth' }
  },

  /**
   * This is the implementation for `cds.requires` which is `cds.env.requires`
   * plus additional entries for all cds.required.<name>.service
   * @returns {import('./cds-requires')}
   */
   _resolved() {
    const dict = Object.create (this)
    for (let [name,e] of Object.entries (this)) if (e.service) {
      if (e.service in dict && !e.override && e.service !== name) {
        throw new Error (`Datasource name '${e.service}' conflicts with service definition, referred to in 'cds.requires.${name}'`)
      }
      else dict[e.service] = { ...e, name }
    }
    return dict
  }
}


const admin = [ 'admin' ]
const builder = [ 'cds.ExtensionDeveloper' ]
const _authentication_strategies = {

  "basic-auth": {
    kind: 'basic',
    users: {},
    tenants: {}
  },
  "mocked-auth": {
    restrict_all_services: false,
    kind: 'mocked',
    users: {
      alice: { tenant: 't1', roles: [ ...admin ] },
      bob:   { tenant: 't1', roles: [ ...builder ] },
      carol: { tenant: 't1', roles: [ ...admin, ...builder ] },
      dave:  { tenant: 't1', roles: [ ...admin ], features: [] },
      erin:  { tenant: 't2', roles: [ ...admin, ...builder ] },
      fred:  { tenant: 't2', features: ['isbn'] },
      me:    { tenant: 't1', features: ['*'] },
      yves:  { roles: ['internal-user'] },
      '*': true
    },
    tenants: {
      t1: { features: [ 'isbn' ], }, // tenant-specific features
      t2: { features: '*', },
    }
  },
  "jwt-auth": {
    kind: 'jwt',
    vcap: { label: 'xsuaa' }
  },
  "ias-auth": {
    kind: 'ias',
    vcap: { label: 'identity' }
  },
  "xsuaa-auth": {
    kind: 'xsuaa',
    vcap: { label: 'xsuaa' }
  },
  "dummy-auth": {
    kind: 'dummy',
  },

}

for (let each of Object.values(_authentication_strategies)) {
  Object.defineProperty (each, 'strategy', {get() {
    return { jwt: 'JWT', mocked: 'mock' }[this.kind] || this.kind
  }})
}

const _services = {

  "app-service": {
    // this is the default implementation used for provided services
    impl: `${_runtime}/common/Service.js`
  },
  "rest": {
    impl: `${_runtime}/remote/Service.js`,
    external: true
  },
  "odata": {
    impl: `${_runtime}/remote/Service.js`,
    external: true
  },
  "odata-v2": { // REVISIT: we should introduce .version
    impl: `${_runtime}/remote/Service.js`,
    external: true
  },
  "odata-v4": { // REVISIT: we should introduce .version
    impl: `${_runtime}/remote/Service.js`,
    external: true
  },
  "graphql": { // REVISIT: we should introduce .version
    impl: `${_runtime}/remote/Service.js`,
    external: true
  },

}


const _databases = {

  "db-defaults": { kind: 'sql' },
  "sql": {
    '[development]': { kind: 'sqlite', credentials: { url: ':memory:' } },
    '[production]': { kind: 'hana' },
  },

  "sqlite": {
    impl: '@cap-js/sqlite',
    credentials: { url: 'db.sqlite' },
  },
  "hana": {
    impl: '@cap-js/hana',
  },
  "hana-cloud": {
    kind: 'hana', "deploy-format": "hdbtable",
  },
  "sql-mt": { // For compatibility only
    '[development]': { kind: 'sqlite' },
    '[production]': { kind: 'hana-mt' },
  },
  "hana-mt": { // For compatibility only
    kind: 'hana', "deploy-format": "hdbtable",
    "vcap": {
      "label": "service-manager"
    }
  },
}


const _queue = {
  queue: "persistent-queue",
  "in-memory-queue": {},
  "persistent-queue": {
    model: "@sap/cds/srv/outbox",
    maxAttempts: 20,
    chunkSize: 10,
    parallel: true,
    storeLastError: true,
    sharedTransaction: false,
    ignoredContext: ['user', 'http', 'model', 'timestamp']
  },
  // legacy
  "in-memory-outbox": "in-memory-queue",
  "persistent-outbox": "persistent-queue",
}


const _messaging = {

  "messaging-defaults": {
    "[development]": { kind: "file-based-messaging" },
    "[production]": { kind: "enterprise-messaging" },
    "[hybrid]": { kind: "enterprise-messaging-amqp" },
  },

  "default-messaging": {
    "[development]": { kind: "local-messaging" },
    "[hybrid]": { kind: "enterprise-messaging-amqp" },
    "[production]": {
      kind: "enterprise-messaging-amqp",
      "[multitenant]": { kind: "enterprise-messaging-http" }
    }
  },

  "local-messaging": {
    impl: `${_runtime}/messaging/service.js`,
    local: true
  },
  "file-based-messaging": {
    impl: `${_runtime}/messaging/file-based.js`,
    file:'~/.cds-msg-box',
    outbox: true
  },
  "enterprise-messaging": {
    kind: "enterprise-messaging-http",
  },
  "enterprise-messaging-shared": { // for temporary compat only
    kind: "enterprise-messaging-amqp",
  },
  "enterprise-messaging-http": {
    deployForProvider: true,
    impl: `${_runtime}/messaging/enterprise-messaging.js`,
    vcap: { label: "enterprise-messaging" },
    outbox: true
  },
  "enterprise-messaging-amqp": {
    impl: `${_runtime}/messaging/enterprise-messaging-shared.js`,
    vcap: { label: "enterprise-messaging" },
    outbox: true
  },
  'message-queuing': {
    impl: `${_runtime}/messaging/message-queuing.js`,
    outbox: true
  },
  'kafka': {
    impl: `${_runtime}/messaging/kafka.js`,
    topic: 'cds.default',
    outbox: true,
    local: false
  },
  "composite-messaging": {
    impl: `${_runtime}/messaging/composite.js`
  },
  "mtx-messaging": {
    kind: "local-messaging",
    "[production]": {
      kind: "redis-messaging"
    }
  },
  "redis-messaging": {
    impl: `${_runtime}/messaging/redis-messaging.js`,
    vcap: { label: "redis-cache" },
    outbox: true
  }

}


const _platform_services = {

  ucl: {
    impl: `${_runtime}/ucl/Service.js`,
    host: 'compass-gateway-sap-mtls.mps.kyma.cloud.sap',
    path: '/director/graphql',
    vcap: { label: 'xsuaa' }
  },

  destinations: {
    vcap: {
      label: 'destination'
    }
  },
  connectivity: {
    vcap: {
      label: 'connectivity'
    }
  },

  approuter: undefined,

}


exports.kinds = {
  ..._authentication_strategies,
  ..._databases,
  ..._services,
  ..._queue,
  ..._messaging,
  ..._platform_services,
}


Object.defineProperty(exports,'_resolved',{value:exports._resolved,enumerable:false}) // hide it in outputs
