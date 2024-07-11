const cds = require('@sap/cds')

if (!cds.env.fiori.lean_draft) {
  throw new Error('"@quadrio/db2" only works if cds.fiori.lean_draft is enabled. Please adapt your configuration.')
}

cds.build?.register?.(
  'plain',
  class Db2BuildPlugin extends cds.build.Plugin {
    static taskDefaults = { src: cds.env.folders.db }

    static hasTask () {
      return cds.requires.db?.kind === 'plain'
    }
    // TODO check if output structure needs to be changed
    // init () {
    //   // different from the default build output structure
    //   this.task.dest = path.join(cds.root, cds.env.build.target !== '.' ? cds.env.build.target : 'gen', 'pg')
    // }
    // async build () {

    // }
  },
)
