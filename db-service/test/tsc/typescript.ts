import { csn } from '@sap/cds/apis/csn'
import { DatabaseService, SQLService, Factory, PreparedStatement, CQN2SQL } from '@cap-js/db-service'

/**
 * Options for the DatabaseService
 */
type Options = {
  kind: string
  impl: string
  credentials: {
    host: string
    port: number
    user: string
    password: string
  }
}

class Driver {
  constructor() {
    return this
  }

  async connect(options: Options): Promise<Driver> {
    const c = options.credentials
    const creds = `http://${c.user}:${c.password}@${c.host}:${c.port}/`
    creds
    return this
  }

  async disconnect(): Promise<void> {
    return
  }

  async validate(): Promise<boolean> {
    return true
  }
}

export class TestDatabaseService extends DatabaseService {
  private options: Options

  constructor(name: string, model: csn, options: Options) {
    super(name, model, options)
    this.options = options || { kind: 'TestDatabaseService', impl: __filename }
  }

  get factory(): Factory<Driver> {
    return {
      options: { min: 1, max: 1 },
      create: async () => {
        const dbc = new Driver()
        return dbc.connect(this.options)
      },
      destroy: async (dbc: Driver) => {
        return dbc.disconnect()
      },
      validate: async (dbc: Driver) => {
        return dbc.validate()
      },
    }
  }
}

export class TestSQLDatabaseService extends SQLService {
  private options: Options

  constructor(name: string, model: csn, options: Options) {
    super(name, model, options)
    this.options = options || { kind: 'TestDatabaseService', impl: __filename }
  }

  get factory(): Factory<Driver> {
    return {
      options: { min: 1, max: 1 },
      create: async () => {
        const dbc = new Driver()
        return dbc.connect(this.options)
      },
      destroy: async (dbc: Driver) => {
        return dbc.disconnect()
      },
      validate: async (dbc: Driver) => {
        return dbc.validate()
      },
    }
  }

  prepare(): PreparedStatement {
    return new TestPreparedStatement()
  }

  exec(sql: string): Promise<unknown> {
    return Promise.resolve(sql)
  }
}

type BindingParameters = unknown | unknown[]

class TestPreparedStatement implements PreparedStatement {
  async run(binding_params: BindingParameters): Promise<number> {
    binding_params
    return 0
  }

  async get(binding_params: BindingParameters): Promise<unknown> {
    binding_params
    return {}
  }

  async all(binding_params: BindingParameters): Promise<unknown[]> {
    binding_params
    return []
  }
}

export class TestCQN2SQL extends CQN2SQL {
  constructor(context: import('@sap/cds/apis/services').ContextProperties) {
    super(context)
  }

  SELECT(cqn: any): string {
    cqn
    return ''
  }
}

// PoC typed SELECT queries and return types
type model = {
  definitions: {
    Books: {
      elements: {
        ID: {
          key: true
          type: 'cds.Integer'
        }
        name: {
          type: 'cds.String'
        }
      }
    }
    Authors: {
      elements: {
        ID: {
          key: true
          type: 'cds.Integer'
        }
        firstname: {
          type: 'cds.String'
        }
      }
    }
  }
}

type cdsTypeMap = {
  'cds.Integer': number
  'cds.String': string
}

type source = keyof model['definitions']
type sourceDefinition<SRC extends keyof model['definitions']> = model['definitions'][SRC]
type sourceElements<TARGET extends source> = keyof sourceDefinition<TARGET>['elements']
type sourceElementRef<TARGET extends source, COL extends sourceElements<TARGET>> = {
  ref: [COL]
}
type sourceElementDefinition<TARGET extends source, COL extends sourceElements<TARGET>> = Extract<
  sourceDefinition<TARGET>['elements'][COL],
  { type: keyof cdsTypeMap }
>
type sourceElementResult<TARGET extends source, COL extends sourceElements<TARGET>> = {
  // REVISIT: The cdsTypeMap for some reason does not resolve the exact type instead returns a union of all possible types
  [key in COL]: cdsTypeMap[sourceElementDefinition<TARGET, key>['type']]
}

class SELECT<TARGET extends source, COLS extends sourceElements<TARGET>> {
  from = <SRC extends source>(x: SRC): SELECT<SRC, COLS> => {
    return this
  }
  columns = <COL extends sourceElements<TARGET>>(x: sourceElementRef<TARGET, COL>[]): SELECT<TARGET, COL> => {
    return this
  }
  then = <RET extends sourceElementResult<TARGET, COLS>>(
    resolve: (ret: RET) => void,
    reject: (error: Error) => void,
  ): void => {
    try {
      // This is not a real solution, but it would work in javascript
      resolve({ ID: 1 } as any)
    } catch (e) {
      reject(new Error('oops'))
    }
  }
}

const sel = new SELECT()

const sel1 = sel.from('Authors')
const sel2 = sel1.columns([{ ref: ['firstname'] }, { ref: ['ID'] }])
const sel3 = sel1.columns([{ ref: ['ID'] }])
;(async () => {
  const res2 = await sel2
  const ID2 = res2.ID
  // ^? const ID2: number
  const firstname2 = res2.firstname
  // ^? const firstname2: string

  const res3 = await sel3
  const ID3 = res3.ID
  // ^? const ID3: number
  // const firstname3 = res3.firstname // <-- does not exist
  // ^? const firstname3: any

  console.log(ID2, firstname2)
  console.log(ID3)
})()
