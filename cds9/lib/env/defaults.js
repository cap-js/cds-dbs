const production = process.env.NODE_ENV === 'production'

module.exports = {

  /**
   * For our own tests to replace hard-coded checks for CDS_ENV === 'better-sqlite'
   * which don't work anymore with cds8 where that is the default.
   */
  get _better_sqlite() {
    if (process.env.CDS_ENV === 'better-sqlite') return true
    let conf = this.requires.db || this.requires.kinds.sql
    if (conf?.impl === '@cap-js/sqlite') return true
    else return false
  },

  production,

  requires: require('./cds-requires'),

  runtime: {
    patch_as_upsert: false,
    put_as_replace: false,
  },

  server: {
    shutdown_on_uncaught_errors: true,
    exit_on_multi_install: true,
    force_exit_timeout: 1111,
    body_parser: undefined, // Allows to configure all body parser options, e.g. limit
    cors:  !production, // CORS middleware is off in production
    index: !production, // index page is off in production
    port: 4004,
  },

  protocols: {
    'odata-v4' : { path: '/odata/v4' },
    'odata-v2' : { path: '/odata/v2' },
    'rest' : { path: '/rest' },
    'hcql' : { path: '/hcql' },
  },

  features: {
    folders: 'fts/*', // where to find feature toggles -> switch on by default when released
    sql_simple_queries: 0,
    pre_compile_edmxs: false,
    odata_new_adapter: true,
    odata_new_parser: true,
    get cds_validate() { return this.odata_new_adapter },
    live_reload: !production,
    in_memory_db: !production,
    test_data: !production,
    test_mocks: !production,
    with_mocks: !production,
    mocked_bindings: !production,
    // skip_unused: 'all',
    skip_unused: true,
    deploy_data_onconflict: 'insert',
    assert_integrity: false,
    precise_timestamps: false,
    ieee754compatible: undefined,
    consistent_params: true, //> remove with cds^10
    // compat for db
    get string_decimals() { return this.ieee754compatible }
  },

  fiori: {
    preview: !production,
    routes: !production,
    lean_draft: true,
    wrap_multiple_errors: true,
    draft_lock_timeout: true,
    draft_deletion_timeout: true
  },

  ql: {
  },

  log: {
    Logger: undefined, //> use default
    '[development]': { format: 'plain' },
    '[production]': { format: 'json' },
    levels: {
      compile: 'warn',
      cli:    'warn'
    },
    service: false,
    // the rest is only applicable for the json formatter
    user: false,
    mask_headers: ['/authorization/i', '/cookie/i', '/cert/i', '/ssl/i'],
    aspects: ['./aspects/cf', './aspects/als', './aspects/cls'], //> EXPERIMENTAL!!!
    // adds custom fields in kibana's error rendering (unknown fields are ignored); key: index
    // note: custom fields are a feature of Application Logging Service (ALS) and not Kibana per se
    als_custom_fields: {
      // sql
      query: 0,
      // generic validations
      target: 1, details: 2,
      // errors
      reason: 3
    },
    cls_custom_fields: [
      // sql
      'query',
      // generic validations
      'target', 'details',
      // errors
      'reason'
    ]
  },

  folders: { // IMPORTANT: order is significant for cds.load('*')
    db: 'db/',
    srv: 'srv/',
    app: 'app/',
  },

  i18n: {
    file: 'i18n', // file basename w/o extension
    folders: [ '_i18n', 'i18n' ],
    languages: 'all', // or ['en','de',...]
    default_language: 'en',
    preserved_locales: [
      // IMPORTANT: Never, never modify this list, as that would break existing projects !!!!
      // Projects can and have to override if they want something different.
      'en_GB',
      'es_CO',
      'es_MX',
      'fr_CA',
      'pt_PT',
      'zh_CN',
      'zh_HK',
      'zh_TW'
    ],
    /** @deprecated */ fallback_bundle: '',
    /** @deprecated */ fatjson: true, // REVISIT: remove in cds9
  },

  odata: {
    flavors: {
      v2: {
        version: 'v2',
        // containment:false,
        // structs:false,
        // refs:false, //> proxies:false,
      },
      v4: {
        version: 'v4',
        // containment:false,
        // structs:false,
        // refs:false, //> proxies:false,
      },
      w4: { // for ODM with Fiori clients
        version: 'v4',
        containment:true,
        structs:true,
        refs:false, //> proxies:false,
        xrefs:false,
      },
      x4: { // for A2X APIs
        version: 'v4',
        containment:true,
        structs:true,
        refs:true, //> proxies:true,
        xrefs:true,
      },
    },
    version: 'v4', // following is to support code completion only...
    structs: undefined,
    refs: undefined,
    proxies: undefined,
    containment: undefined,
    context_with_columns: false,
    max_batch_header_size: '64KiB', // instead of node's 16KiB
  },

  sql: {
    /**
     * Allows to skip generating transitive localized views for entities which don't have own localized elements, but only associations to such.
     * - `undefined` → skipped for new db services.
     * - `false` → always skipped.
     * - `true` → never skipped.
     */
    transitive_localized_views: undefined,
    native_hana_associations: undefined,
    names: 'plain', // or 'quoted', or 'hdbcds'
    dialect: 'sqlite' // or 'plain' or 'hana'
    // dialect: undefined, // or 'sqlite', 'hana', 'postgres', 'h2', ...
  },

  hana: {
    'deploy-format': 'hdbtable',
    journal:  {
      'change-mode': 'alter'
    },
    table_data: {
      column_mapping: {
        LargeBinary: 'decodeBase64'
      }
    }
  },

  build: {
    target: 'gen',
    '[java]': {
      target: '.'
    }
  },

  cdsc: {
    moduleLookupDirectories: ['node_modules/'],
    '[java]': {
      betterSqliteSessionVariables: true,
      moduleLookupDirectories: ['node_modules/', 'target/cds/'],
    }
    // cv2: {
    //   _localized_entries: true,
    //   _texts_entries: true,
    // }
    // toSql: { associations: 'joins' },
    // newCsn: true,
  },

  query: {
    limit: {
      max: 1000
    }
  },

}
