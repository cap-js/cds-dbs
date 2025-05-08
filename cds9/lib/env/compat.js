module.exports = function (conf) {

  const _ = Object.defineProperties (conf, {

    'log-level': {
      get() { return _.log.levels.cli },
      set(x) { _.log.levels.cli = x },
    },

    data: {value:{
      get model(){
        const db = _.requires.db;  if (!db)  return undefined
        return db.model
      },
      set model(v){
        const db = _.requires.db || (_.requires.db={})
        db.model = v
        _.folders.db = v
      },
      get driver(){
        const db = _.requires.db;  if (!db)  return undefined
        return db.kind
      },
      set driver(v){
        const db = _.requires.db || (_.requires.db={})
        db.kind = v
      },
      get url(){
        const db = _.requires.db;  if (!db)  return undefined
        const cred = db.credentials; if (!cred)  return undefined
        return cred.url || cred.database
      },
      set url(v) {
        const isUrl = /.+:\/\/.+/.test(v) // e.g. 'foo://bar'
        const db = _.requires.db || (_.requires.db={})
        const cred = db.credentials || (db.credentials={})
        if (isUrl) {
          cred.url = v // HANA
        } else {
          cred.database = v // sqlite
        }
      },
      get database(){
        const db = _.requires.db;  if (!db)  return undefined
        const cred = db.credentials; if (!cred)  return undefined
        return cred.database
      },
      set database(v){
        const db = _.requires.db || (_.requires.db={})
        const cred = db.credentials || (db.credentials={})
        cred.database = v
      },
      get sql_mapping(){ return _.sql.names },
      set sql_mapping(v){ _.sql.names = v },
    }},
    service: {value:{
      get model() { return _.folders.srv },
      set model(v){ _.folders.srv = v },
      get odata(){ return _.odata },
      set odata(v){ _.odata = v },
    }},
    sql_mapping: {
      get() { return _.sql.names },
      set(v) { _.sql.names = v },
    },
    deploy: {value:{
      _compat: true,
      get models() { return Object.values (_.folders) .concat ([ 'schema', 'services' ]) }
    }}
  })

  const _hana = Object.defineProperties(conf.hana, {
    syntax: {
      get() {
        const format = _hana['deploy-format']
        return format === 'hdbtable' ? 'hdi' : format
      },
      set(v) {
        _hana['deploy-format'] = (v === 'hdi' ? 'hdbtable' : v)
      }
    }
  })

  Object.defineProperties (conf.features, {
    fiori_preview: {
      get: ()=> _.fiori.preview,
      set: (v) => { _.fiori.preview = v },
    },
    fiori_routes: {
      get: ()=> _.fiori.routes,
      set: (v) => { _.fiori.routes = v },
    },
  })

}