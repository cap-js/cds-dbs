using { db as my } from '../db/schema';

service MyService @(path:'/srv') {
 entity P as projection on my.Foo;
}