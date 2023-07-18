import { Factory as GenericFactory, Options } from 'generic-pool'

export interface Factory<T> extends GenericFactory<T> {
  options: Options
}
