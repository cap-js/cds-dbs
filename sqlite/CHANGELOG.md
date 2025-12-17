# Changelog

- All notable changes to this project are documented in this file.
- The format is based on [Keep a Changelog](http://keepachangelog.com/).
- This project adheres to [Semantic Versioning](http://semver.org/).

## [2.1.1](https://github.com/cap-js/cds-dbs/compare/sqlite-v2.1.0...sqlite-v2.1.1) (2025-12-15)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @cap-js/db-service bumped from ^2.7.0 to ^2.8.0

## [2.1.0](https://github.com/cap-js/cds-dbs/compare/sqlite-v2.0.4...sqlite-v2.1.0) (2025-11-26)


### Added

* show default pool configuration in `env` ([#1422](https://github.com/cap-js/cds-dbs/issues/1422)) ([89b397a](https://github.com/cap-js/cds-dbs/commit/89b397ade2a15be8ce81ed3e8d717fc98f1a8107))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @cap-js/db-service bumped from ^2.6.0 to ^2.7.0

## [2.0.4](https://github.com/cap-js/cds-dbs/compare/sqlite-v2.0.3...sqlite-v2.0.4) (2025-10-23)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @cap-js/db-service bumped from ^2 to ^2.6.0

## [2.0.3](https://github.com/cap-js/cds-dbs/compare/sqlite-v2.0.2...sqlite-v2.0.3) (2025-09-30)


### Fixed

* associations in `[@cds](https://github.com/cds).search` are additive ([#1355](https://github.com/cap-js/cds-dbs/issues/1355)) ([ea931cb](https://github.com/cap-js/cds-dbs/commit/ea931cb120c2857aa18a4eb68b893926c0999a9f))

## [2.0.2](https://github.com/cap-js/cds-dbs/compare/sqlite-v2.0.1...sqlite-v2.0.2) (2025-06-30)


### Fixed

* **deps:** update dependency better-sqlite3 to v12 ([#1253](https://github.com/cap-js/cds-dbs/issues/1253)) ([8975490](https://github.com/cap-js/cds-dbs/commit/8975490f29624a96d2c0f128b19a6ddc5b66f91d))

## [2.0.1](https://github.com/cap-js/cds-dbs/compare/sqlite-v2.0.0...sqlite-v2.0.1) (2025-05-27)


### Changed

* remove stream_compat ([#1139](https://github.com/cap-js/cds-dbs/issues/1139)) ([#1144](https://github.com/cap-js/cds-dbs/issues/1144)) ([1b8b2d9](https://github.com/cap-js/cds-dbs/commit/1b8b2d9539cd97be2cef088c98d88ef9ec7dd1bf))

## [2.0.0](https://github.com/cap-js/cds-dbs/compare/sqlite-v1.11.0...sqlite-v2.0.0) (2025-05-07)


### ⚠ BREAKING CHANGES

* update peer dependency to @sap/cds@9 ([#1178](https://github.com/cap-js/cds-dbs/issues/1178))
* update dependency to @cap-js/db-service@2 ([#1178](https://github.com/cap-js/cds-dbs/issues/1178))
* Unfiltered db constraint errors ([#1165](https://github.com/cap-js/cds-dbs/issues/1165))


### Added

* Support for hierarchical queries ([#1093](https://github.com/cap-js/cds-dbs/issues/1093)) ([246e0b3](https://github.com/cap-js/cds-dbs/commit/246e0b38840f7e132ea49cae335b6be7a55354b3))


### Changed

* Unfiltered db constraint errors ([#1165](https://github.com/cap-js/cds-dbs/issues/1165)) ([ff39e22](https://github.com/cap-js/cds-dbs/commit/ff39e22ac6cd3f20c98bc31c1a6bb828aa009796))
* update peer dependency to @sap/cds@9 ([#1178](https://github.com/cap-js/cds-dbs/issues/1178)) ([#1178](https://github.com/cap-js/cds-dbs/issues/1178)) ([0507edd](https://github.com/cap-js/cds-dbs/commit/0507edd4e1dcb98983b1fb65ade1344d978b7524))
* update dependency to @cap-js/db-service@2 ([#1178](https://github.com/cap-js/cds-dbs/issues/1178)) ([#1178](https://github.com/cap-js/cds-dbs/issues/1178)) ([0507edd](https://github.com/cap-js/cds-dbs/commit/0507edd4e1dcb98983b1fb65ade1344d978b7524))

## [1.11.0](https://github.com/cap-js/cds-dbs/compare/sqlite-v1.10.0...sqlite-v1.11.0) (2025-04-17)


### Added

* Result set streaming ([#702](https://github.com/cap-js/cds-dbs/issues/702)) ([2fe02ea](https://github.com/cap-js/cds-dbs/commit/2fe02eafd02993e5697efbdab90ad997fb2c9e00))

## [1.10.0](https://github.com/cap-js/cds-dbs/compare/sqlite-v1.9.0...sqlite-v1.10.0) (2025-03-31)


### Added

* reject recursive cqn queries ([#1089](https://github.com/cap-js/cds-dbs/issues/1089)) ([f09b0f8](https://github.com/cap-js/cds-dbs/commit/f09b0f815c3788349f3d39419990cd1c00963b7d))

## [1.9.0](https://github.com/cap-js/cds-dbs/compare/sqlite-v1.8.0...sqlite-v1.9.0) (2025-03-04)


### Added

* pass through of  arbitrary client options ([#1024](https://github.com/cap-js/cds-dbs/issues/1024)) ([b090ccd](https://github.com/cap-js/cds-dbs/commit/b090ccda2dfd4fa535aa0fd5be9d2fc27531db05))

## [1.8.0](https://github.com/cap-js/cds-dbs/compare/sqlite-v1.7.8...sqlite-v1.8.0) (2025-01-28)


### Added

* support for cds.Map ([#889](https://github.com/cap-js/cds-dbs/issues/889)) ([cde7514](https://github.com/cap-js/cds-dbs/commit/cde7514df20396383e0179ffce838596e3706bb2))

## [1.7.8](https://github.com/cap-js/cds-dbs/compare/sqlite-v1.7.7...sqlite-v1.7.8) (2024-12-16)


### Fixed

* default `[development]` URL to `:memory:` ([#926](https://github.com/cap-js/cds-dbs/issues/926)) ([51e8aa7](https://github.com/cap-js/cds-dbs/commit/51e8aa70868a78594626ba19c02ff495571e751f))

## [1.7.7](https://github.com/cap-js/cds-dbs/compare/sqlite-v1.7.6...sqlite-v1.7.7) (2024-11-14)


### Fixed

* boolean for sql_simple_queries  ([#886](https://github.com/cap-js/cds-dbs/issues/886)) ([d8139fa](https://github.com/cap-js/cds-dbs/commit/d8139fa2ea0cb6bebf966ac5b781b2f8f7c67207))

## [1.7.6](https://github.com/cap-js/cds-dbs/compare/sqlite-v1.7.5...sqlite-v1.7.6) (2024-10-30)


### Fixed

* increase min version cap-js/db-service ([#876](https://github.com/cap-js/cds-dbs/issues/876)) ([e20eef8](https://github.com/cap-js/cds-dbs/commit/e20eef83f3ef0e1595932e31885096ca566cb153))

## [1.7.5](https://github.com/cap-js/cds-dbs/compare/sqlite-v1.7.4...sqlite-v1.7.5) (2024-10-28)


### Fixed

* properly support `default`, `cds.on.insert` and `cds.on.update` for `UPSERT` queries ([#425](https://github.com/cap-js/cds-dbs/issues/425)) ([338e9f5](https://github.com/cap-js/cds-dbs/commit/338e9f5de9109d36013208547fc648c17ce8c7b0))

## [1.7.4](https://github.com/cap-js/cds-dbs/compare/sqlite-v1.7.3...sqlite-v1.7.4) (2024-10-15)


### Fixed

* enforce db file to be existent before server start ([#742](https://github.com/cap-js/cds-dbs/issues/742)) ([64a9018](https://github.com/cap-js/cds-dbs/commit/64a90186aaf44b3426df2e9adbf9a1b4cf2f92b7))
* Improved behavioral consistency between the database services ([#837](https://github.com/cap-js/cds-dbs/issues/837)) ([b6f7187](https://github.com/cap-js/cds-dbs/commit/b6f718701e48dfb1c4c3d98ee016ec45930f8e7b))

## [1.7.3](https://github.com/cap-js/cds-dbs/compare/sqlite-v1.7.2...sqlite-v1.7.3) (2024-07-09)


### Fixed

* expand reach of `cds.features.ieee754compatible` to `int64` ([#722](https://github.com/cap-js/cds-dbs/issues/722)) ([7eef5e9](https://github.com/cap-js/cds-dbs/commit/7eef5e9c5ec286285b2552abd1e673175c59fdc1))

## [1.7.2](https://github.com/cap-js/cds-dbs/compare/sqlite-v1.7.1...sqlite-v1.7.2) (2024-06-19)


### Fixed

* **deps:** update dependency better-sqlite3 to v11 ([#669](https://github.com/cap-js/cds-dbs/issues/669)) ([7167ec5](https://github.com/cap-js/cds-dbs/commit/7167ec53d2e530bfa81def394acfa857e7d5b4fa))

## [1.7.1](https://github.com/cap-js/cds-dbs/compare/sqlite-v1.7.0...sqlite-v1.7.1) (2024-05-16)


### Fixed

* **deps:** update dependency better-sqlite3 to v10 ([#636](https://github.com/cap-js/cds-dbs/issues/636)) ([0cc60e7](https://github.com/cap-js/cds-dbs/commit/0cc60e72ec18e1704a07e0a9bfee5388de682ec7))

## [1.7.0](https://github.com/cap-js/cds-dbs/compare/sqlite-v1.6.0...sqlite-v1.7.0) (2024-05-08)


### Added

* select decimals as strings if cds.env.features.string_decimals ([#616](https://github.com/cap-js/cds-dbs/issues/616)) ([39addbf](https://github.com/cap-js/cds-dbs/commit/39addbfe01da757d86a4d65e62eda86e59fc9b87))


### Fixed

* Change `sql` property to `query` for errors ([#611](https://github.com/cap-js/cds-dbs/issues/611)) ([585577a](https://github.com/cap-js/cds-dbs/commit/585577a9817e7749fb71958c26c4bfa20981c663))
* Improved placeholders and limit clause ([#567](https://github.com/cap-js/cds-dbs/issues/567)) ([d5d5dbb](https://github.com/cap-js/cds-dbs/commit/d5d5dbb7219bcef6134440715cf756fdd439f076))

## [1.6.0](https://github.com/cap-js/cds-dbs/compare/sqlite-v1.5.1...sqlite-v1.6.0) (2024-03-22)


### Added

* forUpdate and forShareLock ([#148](https://github.com/cap-js/cds-dbs/issues/148)) ([99a1170](https://github.com/cap-js/cds-dbs/commit/99a1170e61de4fd0c505834c25a9c03fc34da85b))
* **hana:** drop prepared statements after end of transaction ([#537](https://github.com/cap-js/cds-dbs/issues/537)) ([b1f864e](https://github.com/cap-js/cds-dbs/commit/b1f864e0a3a0e5efacd803d3709379cab76d61cc))


### Fixed

* **`sqlite`:** use keyword list from compiler ([#526](https://github.com/cap-js/cds-dbs/issues/526)) ([a227c61](https://github.com/cap-js/cds-dbs/commit/a227c61312ba9e7d6a54944c822d5de0bb2d3f3c))

### Changed

* this package now requires `@cap-js/db-service >= v1.7.0` ([#545](https://github.com/cap-js/cds-dbs/issues/545)) ([2cec27d](https://github.com/cap-js/cds-dbs/commit/2cec27d91402804c3b2da25cc7169f0d81a7406a))

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
