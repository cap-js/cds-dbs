# Changelog

- All notable changes to this project are documented in this file.
- The format is based on [Keep a Changelog](http://keepachangelog.com/).
- This project adheres to [Semantic Versioning](http://semver.org/).

## [1.3.2](https://github.com/cap-js/cds-dbs/compare/db-service-v1.3.1...db-service-v1.3.2) (2023-10-13)


### Fixed

- preserve $count for result of SELECT queries ([#280](https://github.com/cap-js/cds-dbs/issues/280)) ([23bef24](https://github.com/cap-js/cds-dbs/commit/23bef245e62952a57ed82afcfd238c0b294b2e9e))

## [1.3.1](https://github.com/cap-js/cds-dbs/compare/db-service-v1.3.0...db-service-v1.3.1) (2023-10-10)

### Fixed

- Error message for `search` with multiple arguments. #265

## Version 1.3.0 - 2023-10-06

### Changed

- `INSERT.into(...).rows/values()` is not allowed anymore without specifying `.columns(...)`. #209
- Deep deletion uses correlated subqueries instead of materializing the to be deleted object before. #212

### Fixed

- Various fixes for calculated elements on read. #220 #223 #233
- Don't release to pool connections twice. #243
- Syntax error in `matchesPattern` function. #237
- SELECTs with more than 50 columns does not return `null` values. #238 #261

## Version 1.2.1 - 2023-09-08

### Fixed

- Association expansion in infix filters. #213

## Version 1.2.0 - 2023-09-06

### Added

- support for calculated elements on read. #113 #123
- support for managed associations with default values. #193
- introduced new operator `==` which translates to `IS NOT DISTINCT FROM`. #164

### Fixed

- resolved a type error which occured in some cases for deeply nested `expand`s. #173
- path expression traversing non-foreign-key fields within infix filters are now properly rejected for `exists` predicates. #181
- CQL functions: In the `args` of the `concat` function an `xpr` is now wrapped in parentheses. #196
- Make `UPDATE` and `ofarray` typed column compatible. #184
- Ensure that `INSERT` with `rows` always inserts into the correct column. #193
- Allow `DateTime` columns to compare against their returned value. #206
- Deep Insert using backlink associations as key #199.

## Version 1.1.0 - 2023-08-01

### Fixed

- `UPDATE` with path expressions do not end up in a dump anymore. Instead, a proper error message is emitted.
- `UPDATE` is only noop if it does not include an element annotated with `@cds.on.update`.
- `SELECT` with `'*'` that is not expanded creates now a clearer error when the column name is required.
- `SELECT` with plain SQL statements will return correct result regardless of casing.
- View resolving for streams.

## Version 1.0.1 - 2023-07-03

### Fixed

- Paths addressing a column of the query via `$self.<column>` in `group by` / `order by`, `having` or `where`
  are now correctly substituted.
- Mapping for OData `average` function to ANSI SQL compliant `avg` function.

## Version 1.0.0 - 2023-06-23

- Initial Release
