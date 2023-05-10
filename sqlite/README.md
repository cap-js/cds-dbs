# CDS database service for SQLite

Welcome to the new SQLite database service for [SAP Cloud Application Programming Model](https://cap.cloud.sap) Node.js, based on new, streamlined database architecture and [*better-sqlite* driver](https://www.npmjs.com/package/better-sqlite3) .

>  ⚠️  _**WARNING:** This package is in a beta state._  ⚠️
>


## Installing

### Add `@cap-js/sqlite` as package dependency

As SQLite is commonly used during development or tests only, add it as a dev dependency like so:

```sh
npm add @cap-js/sqlite -D 
```

>  **Note:** There's no need to add the [*better-sqlite*](https://www.npmjs.com/package/better-sqlite3) driver, and it's also not recommended anymore to do so, as that is done transiently. 


### Remove `sqlite3` package dependency

If migrating an existing project you may want to remove the old [*sqlite3* driver](https://www.npmjs.com/package/sqlite3) :

```sh
npm rm sqlite3
```


## Usage


### Via `@cap-js/sqlite` in package dependencies

Adding `@cap-js/sqlite` to your package dependencies as described above is all you need to do. We'll automatically use the new service if that dependency is there in 
`dependencies` or in `devDependencies`. Your configuration can stay as is, e.g.:

```jsonc
{ ...,
  "cds": {
    "requires": { 
      "db": "sql" 
    }
  }
}
```

>  **Note:** This automatically also enables the new, lean draft implementation that's required for the new database services, i.e., `cds.fiori.lean_draft` will be automatically set to `true`.


### Via `better-sqlite` config profile

Alternatively, if you don't have `@cap-js/sqlite` in your package dependencies, but installed in an outer monorepo like in *[cap/samples](https://github.com/sap-samples/cloud-cap-samples)*, you can occasionally run or test your apps with the `better-sqlite` profile using one of these options to specify the profile:

```sh
cds watch bookshop --profile better-sqlite
```
```sh
CDS_ENV=better-sqlite cds watch bookshop
```
```sh
CDS_ENV=better-sqlite jest --silent
```



## New Features & Improvements

### Full Support for Path Expressions

The new SQLite service provides full support for all kinds of [path expressions](https://cap.cloud.sap/docs/cds/cql#path-expressions), including [infix filters](https://cap.cloud.sap/docs/cds/cql#with-infix-filters), and [exists predicates](https://cap.cloud.sap/docs/cds/cql#exists-predicate). For example, you can try this out with *[cap/samples](https://github.com/sap-samples/cloud-cap-samples)* as follows: 

```sh
cds repl --profile better-sqlite
var { server } = await cds.test('bookshop')
var { Books, Authors } = cds.entities
await INSERT.into (Books) .entries ({ title: 'Unwritten Book' })
await INSERT.into (Authors) .entries ({ name: 'Upcoming Author' })
await SELECT `from ${Books} { title as book, author.name as author, genre.name as genre }`
await SELECT `from ${Authors} { books.title as book, name as author, books.genre.name as genre }`
await SELECT `from ${Books} { title as book, author[ID<170].name as author, genre.name as genre }`
await SELECT `from ${Books} { title as book, author.name as author, genre.name as genre }` .where ({'author.name':{like:'Ed%'},or:{'author.ID':170}})
await SELECT `from ${Books} { title as book, author.name as author, genre.name as genre } where author.name like 'Ed%' or author.ID=170`
await SELECT `from ${Books}:author[name like 'Ed%' or ID=170] { books.title as book, name as author, books.genre.name as genre }`
await SELECT `from ${Books}:author[150] { books.title as book, name as author, books.genre.name as genre }`
await SELECT `from ${Authors} { ID, name, books { ID, title }}`
await SELECT `from ${Authors} { ID, name, books { ID, title, genre { ID, name }}}`
await SELECT `from ${Authors} { ID, name, books.genre { ID, name }}`
await SELECT `from ${Authors} { ID, name, books as some_books { ID, title, genre.name as genre }}`
await SELECT `from ${Authors} { ID, name, books[genre.ID=11] as dramatic_books { ID, title, genre.name as genre }}`
await SELECT `from ${Authors} { ID, name, books.genre[name!='Drama'] as no_drama_books_count { count(*) as sum }}`
await SELECT `from ${Authors} { books.genre.ID }`
await SELECT `from ${Authors} { books.genre }`
await SELECT `from ${Authors} { books.genre.name }`

```



### Specified Standard Functions

A specified set of standard functions is now supported and translated to database-specific variants. These functions are by and large the same as specified in OData: 

* `concat`, `indexof`, `length`
* `contains`, `startswith`, `endswith`, `substring`, `matchesPattern`
* `tolower`, `toupper`
* `ceiling`
* `year`, `month`, `day`, `hour`, `minute`, `second`

The db service implementation translates these to the best-possible native SQL functions, thus enhancing the extend of **portable** queries. 

> **Note** that usage is **case-sensitive**, which means you have to write these functions exactly as given above; all-uppercase usages are not supported. 

### Support for Common HANA Functions

In addition to the standard functions, which all new database services will support, the new SQLite service also supports these common HANA functions, to further increase the scope for portable testing:

- `years_between`
- `months_between`
- `days_between`
- `seconds_between`
- `nano100_between`

> Both usages are allowed here: all-lowercase as given above, as well as all-uppercase.

### Support for Session Context Variables

The new SQLite service can leverage  [*better-sqlite*](https://www.npmjs.com/package/better-sqlite3)'s user-defined functions to support *session context* variables. In particular, the pseudo variables `$user.id`, `$user.locale`,  `$valid.from`, and `$valid.to` are available in native SQL queries like so: 

```sql
SELECT session_context('$user.id')
SELECT session_context('$user.locale')
SELECT session_context('$valid.from')
SELECT session_context('$valid.to')
```

Amongst other, this allows us to get rid of static helper views for localized data like `localized_de_sap_capire_Books`. 

### Deep Reads via Single Queries

The old database service implementation(s) translated deep reads, i.e., SELECTs with expands, into several database queries and collected the individual results into deep result structures. The new service uses `json_object` functions and alike to instead do that in one single query, with sub selects, which greatly improves performance. 

### New `SELECT.localized` Queries

With the old implementation when running queries like `SELECT.from(Books)` would always return localized data, without being able to easily read the non-localized data. The new service does only what you asked for, offering new `SELECT.localized` options:

```js
let books = await SELECT.from(Books)       //> non-localized data
let lbooks = await SELECT.localized(Books) //> localized data
```

Usage variants include:  

```js
SELECT.localized(Books)
SELECT.from.localized(Books)
SELECT.one.localized(Books)
```

> **Note:** Queries executed through generic application service handlers continue to serve localized data as before. 

### Using Lean Draft Implementation

The old implementation was overly polluted with draft handling. But as draft is actually a Fiori UI concept, that should not be the case. Hence, we eliminated all draft handling from the new database service implementations, and implemented draft in a modular, non-intrusive way — called *'Lean Draft'*. The most important change is that we don't do expensive UNIONs anymore but work with single cheap selects. 

When using the new SQLite service the new `cds.fiori.lean_draft` mode is automatically switched on. You may additionally switch on `cds.fiori_draft_compat` in case you run into problems. 

More detailed documentation for that will follow soon. 

### Performance Improvements

The combination of the above-mentioned improvements commonly leads to significant performance improvements. For example displaying the list page of Travels in [cap/sflight](https://github.com/SAP-samples/cap-sflight) took **>250ms** in the past, and **~15ms** now.

## Known Limitations & Changes

- Node v14 is no longer supported → will be dropped anyways with upcoming cds7.
- JOINs and UNIONs by CQN are no longer supported → use plain SQL instead.
* CQNs with subqueries require table aliases to refer to elements of outer queries.
* CQNs with an empty columns array now throws an error.
* Search: only single values are allowed as search expression.
* CSV input: column names like `author.ID` are disallowed → use  `author_ID` instead.
* No `default` values are returned anymore for `virtual` elements.
* `SELECT.from(...)` queries on database level don't return localized data anymore → use `SELECT.localized(...)`
* Standard functions in CQN are case-sensitive → don't uppercase them.
* For `@cds.on.insert/update`annotations only `$now` and `$user.id` are supported.
* The `cds/db.stream()` methods are not implemented yet → will come soon.

_The list of important changes is not final and will be constantly updated._
