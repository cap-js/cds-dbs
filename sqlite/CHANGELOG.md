# Changelog

- All notable changes to this project are documented in this file.
- The format is based on [Keep a Changelog](http://keepachangelog.com/).
- This project adheres to [Semantic Versioning](http://semver.org/).

## [1.5.1](https://github.com/cap-js/cds-dbs/compare/sqlite-v1.5.0...sqlite-v1.5.1) (2024-02-16)


### Fixed

* **`sqlite`:** Retain Error object for unique constraint violation ([#446](https://github.com/cap-js/cds-dbs/issues/446)) ([d27ee79](https://github.com/cap-js/cds-dbs/commit/d27ee79b4c4eea8522bf5dd2a288638f54029567))

## [1.5.0](https://github.com/cap-js/cds-dbs/compare/sqlite-v1.4.0...sqlite-v1.5.0) (2024-02-02)


### Added

* SELECT returns LargeBinaries as streams unless feature flag "stream_compat" is set ([#251](https://github.com/cap-js/cds-dbs/issues/251)) ([8165a4a](https://github.com/cap-js/cds-dbs/commit/8165a4a3f6bb21c970668c8873f9d9c662b43780))
* Support Readable Streams inside INSERT.entries ([#343](https://github.com/cap-js/cds-dbs/issues/343)) ([f6faf89](https://github.com/cap-js/cds-dbs/commit/f6faf8955b7888479c66f1727ade65b382611c2f))


### Fixed

* config in streaming test with compat flag ([#412](https://github.com/cap-js/cds-dbs/issues/412)) ([335a178](https://github.com/cap-js/cds-dbs/commit/335a1785e216b581759f75154fef7b1b43e6ca17))
* Do not generate UUIDs for association keys ([#398](https://github.com/cap-js/cds-dbs/issues/398)) ([9970e14](https://github.com/cap-js/cds-dbs/commit/9970e14352679711a9c60807608becff05151fc4))
* make @cap-js/sqlite work with better-sqlite3@9.3.0 ([#422](https://github.com/cap-js/cds-dbs/issues/422)) ([44c0a59](https://github.com/cap-js/cds-dbs/commit/44c0a59277b14be0b81b7f80555e18377ddbfe3c))
* sqlite date string compatibility parsing only for valid dates ([#410](https://github.com/cap-js/cds-dbs/issues/410)) ([2a8bb2d](https://github.com/cap-js/cds-dbs/commit/2a8bb2d60940760c6280d8cc06100cb9087194b5)), closes [#409](https://github.com/cap-js/cds-dbs/issues/409)
* UPSERT for @cap-js/hana for entities with multiple keys ([#418](https://github.com/cap-js/cds-dbs/issues/418)) ([9bbac6e](https://github.com/cap-js/cds-dbs/commit/9bbac6ebbbddfa2f620833ce195eedeb0a79f43e))

## [1.4.0](https://github.com/cap-js/cds-dbs/compare/sqlite-v1.3.1...sqlite-v1.4.0) (2023-11-20)


### Added

* **temporal data:** add time slice key to conflict clause ([#249](https://github.com/cap-js/cds-dbs/issues/249)) ([67b8edf](https://github.com/cap-js/cds-dbs/commit/67b8edf9b7f6b0fbab0010d7c93ed03a01e103ed))


### Fixed

* align time function behavior ([#322](https://github.com/cap-js/cds-dbs/issues/322)) ([c3ab40a](https://github.com/cap-js/cds-dbs/commit/c3ab40a007c105465349dd2f612178367b8e713a))
* date functions with null value ([#347](https://github.com/cap-js/cds-dbs/issues/347)) ([bdc8967](https://github.com/cap-js/cds-dbs/commit/bdc8967f07276acdb249dec42231d432e132e0d4))


### Changed

* upgrade to better-sqlite@9 ([#334](https://github.com/cap-js/cds-dbs/issues/334)) ([5184e41](https://github.com/cap-js/cds-dbs/commit/5184e4155ccd1a2945a1fc033204e24425d70341))

## [1.3.1](https://github.com/cap-js/cds-dbs/compare/v1.3.0...v1.3.1) (2023-10-10)

### Changed

- Updated minimum required version of `@cap-js/db-service`.

## Version 1.3.0 - 2023-10-06

### Fixed

- `CURRENT_TIMESTAMP` in view definition preserves the timezone. #254 

## Version 1.2.1 - 2023-09-08

### Fixed

- Adapt implementation to comply with implication of SQLite version 3.43 which is included in `better-sqlite3@8.6.0`. #210

## Version 1.2.0 - 2023-09-06

### Changed

- `cds.Decimal` and `cds.Float` return numbers instead of strings

## Version 1.1.0 - 2023-08-01

### Changed

- Updated minimum required version of `@cap-js/db-service`.

## Version 1.0.1 - 2023-07-03

### Changed

- Updated minimum required version of `@cap-js/db-service` 

## Version 1.0.0 - 2023-06-23

- First official release

## Version 0.2.0 - 2023-05-03

- Continuous improvements

## Version 0.1.0 - 2023-04-04

- Initial release
