
/**
 * Interface of prepared statement objects as returned by {@link SQLService#prepare}
 */
export interface PreparedStatement {

  /**
   * Executes a prepared DML query, i.e., INSERT, UPDATE, DELETE, CREATE, DROP
   */
  async run(binding_params : unknown|unknown[]) : Promise<unknown|unknown[]>

  /**
   * Executes a prepared SELECT query and returns a single/first row only
   */
  async get(binding_params: unknown|unknown[]) : Promise<unknown>

  /**
   * Executes a prepared SELECT query and returns an array of all rows
  */
 async all(binding_params: unknown|unknown[]) : Promise<unknown>

 /**
   * Executes a prepared SELECT query and returns a stream of the result
   */
  async stream(binding_params: unknown|unknown[]) : Promise<ReadableStream<string|Buffer>>
}
