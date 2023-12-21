# Changelog

- All notable changes to this project are documented in this file.
- The format is based on [Keep a Changelog](http://keepachangelog.com/).
- This project adheres to [Semantic Versioning](http://semver.org/).

## [1.5.1](https://github.com/cap-js/cds-dbs/compare/db-service-v1.5.0...db-service-v1.5.1) (2023-12-20)


### Fixed

* **cqn2sql:** supporting calculated elements ([#387](https://github.com/cap-js/cds-dbs/issues/387)) ([2153fb9](https://github.com/cap-js/cds-dbs/commit/2153fb9a3910cd4afa3a91918e6cf682646492b7))
* do not rely on db constraints for deep delete ([#390](https://github.com/cap-js/cds-dbs/issues/390)) ([9623af6](https://github.com/cap-js/cds-dbs/commit/9623af64db97cfe15ef07b659635850fc908f77c))


### Performance Improvements

* HANA list placeholder ([#380](https://github.com/cap-js/cds-dbs/issues/380)) ([3eadfea](https://github.com/cap-js/cds-dbs/commit/3eadfea7b94f485030cc8bd0bd298ce088586422))

## [1.5.0](https://github.com/cap-js/cds-dbs/compare/db-service-v1.4.0...db-service-v1.5.0) (2023-12-06)


### Added

* Improved connection pool for HANAService ([#349](https://github.com/cap-js/cds-dbs/issues/349)) ([1c284e6](https://github.com/cap-js/cds-dbs/commit/1c284e69cccd76daad52249c0462bc62aa4d11a8))


### Fixed

* **localized:** `ref`s in subqueries in `from` are translated ([#366](https://github.com/cap-js/cds-dbs/issues/366)) ([cfe4897](https://github.com/cap-js/cds-dbs/commit/cfe489715db0854d30b90b7f13c024e6e90be497))
* wrong odata count in filter with groupby ([#352](https://github.com/cap-js/cds-dbs/issues/352)) ([70690a1](https://github.com/cap-js/cds-dbs/commit/70690a1a13e72bfbb66f03bf315d3f2d48672bf6))

## [1.4.0](https://github.com/cap-js/cds-dbs/compare/db-service-v1.3.2...db-service-v1.4.0) (2023-11-20)


### Added

* **`UPDATE`/`DELETE`:** Enable path expressions for improved data manipulation ([#325](https://github.com/cap-js/cds-dbs/issues/325)) ([94f0776](https://github.com/cap-js/cds-dbs/commit/94f077661cffad8f137dc692a2cb9b0ae5e4d75b))
* **temporal data:** add time slice key to conflict clause ([#249](https://github.com/cap-js/cds-dbs/issues/249)) ([67b8edf](https://github.com/cap-js/cds-dbs/commit/67b8edf9b7f6b0fbab0010d7c93ed03a01e103ed))
* use place holders for update and delete ([#323](https://github.com/cap-js/cds-dbs/issues/323)) ([81472b9](https://github.com/cap-js/cds-dbs/commit/81472b971183f701e401247611310be56745a87a))


### Fixed

* align time function behavior ([#322](https://github.com/cap-js/cds-dbs/issues/322)) ([c3ab40a](https://github.com/cap-js/cds-dbs/commit/c3ab40a007c105465349dd2f612178367b8e713a))
* **calculated elements:** path expressions in `func.args` within `xpr` ([#321](https://github.com/cap-js/cds-dbs/issues/321)) ([cee25e3](https://github.com/cap-js/cds-dbs/commit/cee25e33cf289592a87779cfa34dddc53e467676))
* Disconnect db service on shutdown ([#327](https://github.com/cap-js/cds-dbs/issues/327)) ([8471bda](https://github.com/cap-js/cds-dbs/commit/8471bda44fc030205abec45b1581b2cf6ed7c800))
* non-fk access in filter conditions are properly rejected ([#336](https://github.com/cap-js/cds-dbs/issues/336)) ([4c948fe](https://github.com/cap-js/cds-dbs/commit/4c948fecead1de562e1583886516413e131a39aa))
* **search:** check calculated columns at any depth ([#310](https://github.com/cap-js/cds-dbs/issues/310)) ([8fd6153](https://github.com/cap-js/cds-dbs/commit/8fd6153dfcd472a6d95c33faa58c4b3f96f485df))

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
