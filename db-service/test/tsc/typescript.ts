import { csn } from '@sap/cds/apis/csn'
import { SELECT } from '@sap/cds/apis/cqn'
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

  async disconnect(): Promise<void> {}

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

  exec(sql: string): Promise<any> {
    return Promise.resolve(sql)
  }
}

type BindingParameters = {} | []

class TestPreparedStatement implements PreparedStatement {
  constructor() {}

  async run(binding_params: BindingParameters): Promise<any> {
    binding_params
    return 0
  }

  async get(binding_params: BindingParameters): Promise<any> {
    binding_params
    return {}
  }

  async all(binding_params: BindingParameters): Promise<any> {
    binding_params
    return []
  }
}

class TestCQN2SQL extends CQN2SQL {
  constructor(context: import('@sap/cds/apis/services').ContextProperties) {
    super(context)
  }

  SELECT(cqn: SELECT): string {
    cqn
    return ''
  }
}
