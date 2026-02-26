# Changelog

- All notable changes to this project are documented in this file.
- The format is based on [Keep a Changelog](http://keepachangelog.com/).
- This project adheres to [Semantic Versioning](http://semver.org/).

## [2.1.3](https://github.com/cap-js/cds-dbs/compare/postgres-v2.1.2...postgres-v2.1.3) (2026-02-03)


### Fixed

* `between_*` function input types ([#1468](https://github.com/cap-js/cds-dbs/issues/1468)) ([1d3905a](https://github.com/cap-js/cds-dbs/commit/1d3905a0a8e6b2a6b11c787456c86e93ac2a41cd))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @cap-js/db-service bumped from ^2.8.1 to ^2.8.2

## [2.1.2](https://github.com/cap-js/cds-dbs/compare/postgres-v2.1.1...postgres-v2.1.2) (2025-12-19)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @cap-js/db-service bumped from ^2.8.0 to ^2.8.1

## [2.1.1](https://github.com/cap-js/cds-dbs/compare/postgres-v2.1.0...postgres-v2.1.1) (2025-12-15)


### Fixed

* fixed versions in postgres deployer package.json ([#1429](https://github.com/cap-js/cds-dbs/issues/1429)) ([c70ab92](https://github.com/cap-js/cds-dbs/commit/c70ab92a290e90eea64d4f54c25b301e8f3f6a0d))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @cap-js/db-service bumped from ^2.7.0 to ^2.8.0

## [2.1.0](https://github.com/cap-js/cds-dbs/compare/postgres-v2.0.6...postgres-v2.1.0) (2025-11-26)


### Added

* show default pool configuration in `env` ([#1422](https://github.com/cap-js/cds-dbs/issues/1422)) ([89b397a](https://github.com/cap-js/cds-dbs/commit/89b397ade2a15be8ce81ed3e8d717fc98f1a8107))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @cap-js/db-service bumped from ^2.6.0 to ^2.7.0

## [2.0.6](https://github.com/cap-js/cds-dbs/compare/postgres-v2.0.5...postgres-v2.0.6) (2025-10-23)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @cap-js/db-service bumped from ^2 to ^2.6.0

## [2.0.5](https://github.com/cap-js/cds-dbs/compare/postgres-v2.0.4...postgres-v2.0.5) (2025-08-27)


### Fixed

* cds build for postgres ([#1320](https://github.com/cap-js/cds-dbs/issues/1320)) ([cb27495](https://github.com/cap-js/cds-dbs/commit/cb27495889bbab8fc55d37e338f4cac8e066bd4b))

## [2.0.4](https://github.com/cap-js/cds-dbs/compare/postgres-v2.0.3...postgres-v2.0.4) (2025-07-28)


### Fixed

* ensure ordering of `ParameterStream` chunks ([#1280](https://github.com/cap-js/cds-dbs/issues/1280)) ([a49e200](https://github.com/cap-js/cds-dbs/commit/a49e200eb3c08cedcea04ffc5ecb7c664ee885c0))

## [2.0.3](https://github.com/cap-js/cds-dbs/compare/postgres-v2.0.2...postgres-v2.0.3) (2025-06-30)


### Fixed

* **`cds-build`:** retain more build relevant options in the deployer app ([#1206](https://github.com/cap-js/cds-dbs/issues/1206)) ([e7ed70f](https://github.com/cap-js/cds-dbs/commit/e7ed70f36920867ec0063d29255e3681dec1b60c))

## [2.0.2](https://github.com/cap-js/cds-dbs/compare/postgres-v2.0.1...postgres-v2.0.2) (2025-06-04)


### Fixed

* Allow raw streams to have empty results ([#1224](https://github.com/cap-js/cds-dbs/issues/1224)) ([0a59e69](https://github.com/cap-js/cds-dbs/commit/0a59e69eae2f701b5c475512fd1cd83cfb586153))

## [2.0.1](https://github.com/cap-js/cds-dbs/compare/postgres-v2.0.0...postgres-v2.0.1) (2025-05-27)


### ⚠ BREAKING CHANGES

* remove PG `?` placeholder replacement ([#1180](https://github.com/cap-js/cds-dbs/issues/1180))


### Fixed

* Enable mixing stream and normal parameters in queries ([#1179](https://github.com/cap-js/cds-dbs/issues/1179)) ([7ee8083](https://github.com/cap-js/cds-dbs/commit/7ee808365426072250dd6de87abd11215f44561a))
* hierarchies in quoted mode ([3465cba](https://github.com/cap-js/cds-dbs/commit/3465cbab579d4560d12d3b230c55b746d4d3f5a5))
* only sort by locale if locale is set ([#1193](https://github.com/cap-js/cds-dbs/issues/1193)) ([3465cba](https://github.com/cap-js/cds-dbs/commit/3465cbab579d4560d12d3b230c55b746d4d3f5a5))


### Changed

* remove PG `?` placeholder replacement ([#1180](https://github.com/cap-js/cds-dbs/issues/1180)) ([a1e0bd9](https://github.com/cap-js/cds-dbs/commit/a1e0bd9fe8501c284d8cbfc8d79d4dddda34c087))
* remove stream_compat ([#1139](https://github.com/cap-js/cds-dbs/issues/1139)) ([#1144](https://github.com/cap-js/cds-dbs/issues/1144)) ([1b8b2d9](https://github.com/cap-js/cds-dbs/commit/1b8b2d9539cd97be2cef088c98d88ef9ec7dd1bf))

## [2.0.0](https://github.com/cap-js/cds-dbs/compare/postgres-v1.14.0...postgres-v2.0.0) (2025-05-07)


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

## [1.14.0](https://github.com/cap-js/cds-dbs/compare/postgres-v1.13.0...postgres-v1.14.0) (2025-04-17)


### Added

* Result set streaming ([#702](https://github.com/cap-js/cds-dbs/issues/702)) ([2fe02ea](https://github.com/cap-js/cds-dbs/commit/2fe02eafd02993e5697efbdab90ad997fb2c9e00))

## [1.13.0](https://github.com/cap-js/cds-dbs/compare/postgres-v1.12.0...postgres-v1.13.0) (2025-03-31)


### Added

* **collate:** only collate if locale is provided ([#1060](https://github.com/cap-js/cds-dbs/issues/1060)) ([dedd768](https://github.com/cap-js/cds-dbs/commit/dedd768c085aa29be0e38db11f11678ff55d5b7b))
* **forUpdate:** ignore locked ([#1074](https://github.com/cap-js/cds-dbs/issues/1074)) ([163480b](https://github.com/cap-js/cds-dbs/commit/163480b245b18a2829cd871c2f053c82bcc1abef))


### Fixed

* consider `nulls first | last` on `orderBy` ([#1064](https://github.com/cap-js/cds-dbs/issues/1064)) ([c6bed60](https://github.com/cap-js/cds-dbs/commit/c6bed60f0d93b9f4a73c976727f30172707c60d9)), closes [#1062](https://github.com/cap-js/cds-dbs/issues/1062)
* Persist assert_integrity feature ([#1032](https://github.com/cap-js/cds-dbs/issues/1032)) ([2956279](https://github.com/cap-js/cds-dbs/commit/2956279777ac94330c98373d8bca32cf0f8e967e))

## [1.12.0](https://github.com/cap-js/cds-dbs/compare/postgres-v1.11.1...postgres-v1.12.0) (2025-03-04)


### Added

* pass through of  arbitrary client options ([#1024](https://github.com/cap-js/cds-dbs/issues/1024)) ([b090ccd](https://github.com/cap-js/cds-dbs/commit/b090ccda2dfd4fa535aa0fd5be9d2fc27531db05))


### Fixed

* `expand@odata.count` queries ([#966](https://github.com/cap-js/cds-dbs/issues/966)) ([6607a84](https://github.com/cap-js/cds-dbs/commit/6607a8404aa70f2f3f7c6c65c7e9b1c324a5230b))

## [1.11.1](https://github.com/cap-js/cds-dbs/compare/postgres-v1.11.0...postgres-v1.11.1) (2025-02-09)


### Fixed

* postgres build plugin w `--production` ([#1018](https://github.com/cap-js/cds-dbs/issues/1018)) ([aafffc9](https://github.com/cap-js/cds-dbs/commit/aafffc99cb509380e5ae7738376e4d30ce5d66f2))

## [1.11.0](https://github.com/cap-js/cds-dbs/compare/postgres-v1.10.5...postgres-v1.11.0) (2025-01-28)


### Added

* support for cds.Map ([#889](https://github.com/cap-js/cds-dbs/issues/889)) ([cde7514](https://github.com/cap-js/cds-dbs/commit/cde7514df20396383e0179ffce838596e3706bb2))


### Fixed

* starts endswith for null values ([#975](https://github.com/cap-js/cds-dbs/issues/975)) ([f0330bc](https://github.com/cap-js/cds-dbs/commit/f0330bc334fd3a8ed5377afcdd04b731baa8c753))

## [1.10.5](https://github.com/cap-js/cds-dbs/compare/postgres-v1.10.4...postgres-v1.10.5) (2024-12-16)


### Fixed

* sort property is case insensitive ([#924](https://github.com/cap-js/cds-dbs/issues/924)) ([2c72c87](https://github.com/cap-js/cds-dbs/commit/2c72c871d6c7f65797b8bd8692305149b3ea65f8))

## [1.10.4](https://github.com/cap-js/cds-dbs/compare/postgres-v1.10.3...postgres-v1.10.4) (2024-11-14)


### Fixed

* enable nulls first ([#893](https://github.com/cap-js/cds-dbs/issues/893)) ([6684436](https://github.com/cap-js/cds-dbs/commit/66844363588864813d304a9dcfd66e856c7542dd))

## [1.10.3](https://github.com/cap-js/cds-dbs/compare/postgres-v1.10.2...postgres-v1.10.3) (2024-10-30)


### Fixed

* increase min version cap-js/db-service ([#876](https://github.com/cap-js/cds-dbs/issues/876)) ([e20eef8](https://github.com/cap-js/cds-dbs/commit/e20eef83f3ef0e1595932e31885096ca566cb153))

## [1.10.2](https://github.com/cap-js/cds-dbs/compare/postgres-v1.10.1...postgres-v1.10.2) (2024-10-28)


### Fixed

* properly support `default`, `cds.on.insert` and `cds.on.update` for `UPSERT` queries ([#425](https://github.com/cap-js/cds-dbs/issues/425)) ([338e9f5](https://github.com/cap-js/cds-dbs/commit/338e9f5de9109d36013208547fc648c17ce8c7b0))

## [1.10.1](https://github.com/cap-js/cds-dbs/compare/postgres-v1.10.0...postgres-v1.10.1) (2024-10-15)


### Fixed

* add cds schema for postgres build plugin ([#843](https://github.com/cap-js/cds-dbs/issues/843)) ([6306d5c](https://github.com/cap-js/cds-dbs/commit/6306d5ce50c071b38a3d9f61b0820ea713a782d8))
* Improved behavioral consistency between the database services ([#837](https://github.com/cap-js/cds-dbs/issues/837)) ([b6f7187](https://github.com/cap-js/cds-dbs/commit/b6f718701e48dfb1c4c3d98ee016ec45930f8e7b))
* null as default value ([#845](https://github.com/cap-js/cds-dbs/issues/845)) ([0041ec0](https://github.com/cap-js/cds-dbs/commit/0041ec0a26c29b30f91470d93611b29acd837216))

## [1.10.0](https://github.com/cap-js/cds-dbs/compare/postgres-v1.9.1...postgres-v1.10.0) (2024-07-25)


### Changed

* build script generates cds8 dependency in deployer app ([#758](https://github.com/cap-js/cds-dbs/issues/758)) ([5c21a67](https://github.com/cap-js/cds-dbs/commit/5c21a6758ccc927cde857e98145c3f4393deb739))

## [1.9.1](https://github.com/cap-js/cds-dbs/compare/postgres-v1.9.0...postgres-v1.9.1) (2024-07-09)


### Fixed

* expand reach of `cds.features.ieee754compatible` to `int64` ([#722](https://github.com/cap-js/cds-dbs/issues/722)) ([7eef5e9](https://github.com/cap-js/cds-dbs/commit/7eef5e9c5ec286285b2552abd1e673175c59fdc1))

## [1.9.0](https://github.com/cap-js/cds-dbs/compare/postgres-v1.8.0...postgres-v1.9.0) (2024-05-29)


### Added

* Add simple queries feature flag ([#660](https://github.com/cap-js/cds-dbs/issues/660)) ([3335202](https://github.com/cap-js/cds-dbs/commit/33352024201a96cc6bdfa30a0fe3fff4227dee10))

## [1.8.0](https://github.com/cap-js/cds-dbs/compare/postgres-v1.7.0...postgres-v1.8.0) (2024-05-08)


### Added

* select decimals as strings if cds.env.features.string_decimals ([#616](https://github.com/cap-js/cds-dbs/issues/616)) ([39addbf](https://github.com/cap-js/cds-dbs/commit/39addbfe01da757d86a4d65e62eda86e59fc9b87))


### Fixed

* Align all quote functions with @sap/cds-compiler ([#619](https://github.com/cap-js/cds-dbs/issues/619)) ([42e9828](https://github.com/cap-js/cds-dbs/commit/42e9828baf11ec55281ea634ce56ce93e6741b91))
* Change `sql` property to `query` for errors ([#611](https://github.com/cap-js/cds-dbs/issues/611)) ([585577a](https://github.com/cap-js/cds-dbs/commit/585577a9817e7749fb71958c26c4bfa20981c663))
* Improved placeholders and limit clause ([#567](https://github.com/cap-js/cds-dbs/issues/567)) ([d5d5dbb](https://github.com/cap-js/cds-dbs/commit/d5d5dbb7219bcef6134440715cf756fdd439f076))
* Use json datatype for `INSERT` ([#582](https://github.com/cap-js/cds-dbs/issues/582)) ([f1c9c89](https://github.com/cap-js/cds-dbs/commit/f1c9c89036a7f8e4709c67d713d06926630aa36d))

## [1.7.0](https://github.com/cap-js/cds-dbs/compare/postgres-v1.6.0...postgres-v1.7.0) (2024-04-12)


### Added

* Odata built-in query functions ([#558](https://github.com/cap-js/cds-dbs/issues/558)) ([6e63367](https://github.com/cap-js/cds-dbs/commit/6e6336757129c4a9dac56f93fd768bb41d071c46))

## [1.6.0](https://github.com/cap-js/cds-dbs/compare/postgres-v1.5.1...postgres-v1.6.0) (2024-03-22)


### Added

* also support lowercase matchespattern function ([#528](https://github.com/cap-js/cds-dbs/issues/528)) ([6ea574e](https://github.com/cap-js/cds-dbs/commit/6ea574ee67ef5e42e4f8ccbe4fe91b46097de129))
* forUpdate and forShareLock ([#148](https://github.com/cap-js/cds-dbs/issues/148)) ([99a1170](https://github.com/cap-js/cds-dbs/commit/99a1170e61de4fd0c505834c25a9c03fc34da85b))


### Changed

* use new cds build API @sap/cds-dk &gt;= 7.5.0 ([#508](https://github.com/cap-js/cds-dbs/issues/508)) ([ef22ebe](https://github.com/cap-js/cds-dbs/commit/ef22ebe68c6a554d4042a0a19bae3b2e1d56cb01))
* this package now requires `@cap-js/db-service >= v1.7.0` ([#545](https://github.com/cap-js/cds-dbs/issues/545)) ([2cec27d](https://github.com/cap-js/cds-dbs/commit/2cec27d91402804c3b2da25cc7169f0d81a7406a))

## [1.5.1](https://github.com/cap-js/cds-dbs/compare/postgres-v1.5.0...postgres-v1.5.1) (2024-02-16)


### Fixed

* **`sqlite`:** Retain Error object for unique constraint violation ([#446](https://github.com/cap-js/cds-dbs/issues/446)) ([d27ee79](https://github.com/cap-js/cds-dbs/commit/d27ee79b4c4eea8522bf5dd2a288638f54029567))

## [1.5.0](https://github.com/cap-js/cds-dbs/compare/postgres-v1.4.1...postgres-v1.5.0) (2024-02-02)


### Added

* SELECT returns LargeBinaries as streams unless feature flag "stream_compat" is set ([#251](https://github.com/cap-js/cds-dbs/issues/251)) ([8165a4a](https://github.com/cap-js/cds-dbs/commit/8165a4a3f6bb21c970668c8873f9d9c662b43780))
* Support Readable Streams inside INSERT.entries ([#343](https://github.com/cap-js/cds-dbs/issues/343)) ([f6faf89](https://github.com/cap-js/cds-dbs/commit/f6faf8955b7888479c66f1727ade65b382611c2f))


### Fixed

* switch Postgres from json to jsonb ([#402](https://github.com/cap-js/cds-dbs/issues/402)) ([c98a964](https://github.com/cap-js/cds-dbs/commit/c98a964a34232267aece337dc6f6bedf03e9891a))
* UPSERT for @cap-js/hana for entities with multiple keys ([#418](https://github.com/cap-js/cds-dbs/issues/418)) ([9bbac6e](https://github.com/cap-js/cds-dbs/commit/9bbac6ebbbddfa2f620833ce195eedeb0a79f43e))

## [1.4.1](https://github.com/cap-js/cds-dbs/compare/postgres-v1.4.0...postgres-v1.4.1) (2023-11-24)


### Fixed

* `cds build` now generates the correct output folder structure for Node.js and Java apps. ([#353](https://github.com/cap-js/cds-dbs/issues/353)) ([875aca4](https://github.com/cap-js/cds-dbs/commit/875aca4f5a0ee71bcfbb13be47d4349970b40605))

## [1.4.0](https://github.com/cap-js/cds-dbs/compare/postgres-v1.3.1...postgres-v1.4.0) (2023-11-20)


### Added

* adapt build plugin implementation to new API ([#319](https://github.com/cap-js/cds-dbs/issues/319)) ([aec9966](https://github.com/cap-js/cds-dbs/commit/aec9966e54cd9900f85fe7406cbe38ec5c6fa4b9))


### Fixed

* align time function behavior ([#322](https://github.com/cap-js/cds-dbs/issues/322)) ([c3ab40a](https://github.com/cap-js/cds-dbs/commit/c3ab40a007c105465349dd2f612178367b8e713a))

## [1.3.1](https://github.com/cap-js/cds-dbs/compare/v1.3.0...v1.3.1) (2023-10-10)

### Fixed

- `cds build`-relevant files are now correctly packaged into the release. #266

## Version 1.3.0 - 2023-10-06

### Added

- `cds build` is now natively supported in `@cap-js/postgres`. Thus, a `cds build` will automatically generate deployment artifacts for Postgres-enabled projects.

## Version 1.2.1 - 2023-09-08

### Changed

- Bump minimum required version of `@cap-js/db-service`

## Version 1.2.0 - 2023-09-06

### Added

- Reduced the usage of `is not distinct [not] from`. #157

### Fixed

- [Reserved words](https://www.postgresql.org/docs/current/sql-keywords-appendix.html) are now used to automatically escape reserved words which are used as identifier. #178
- Remove column count limitation. #150

## Version 1.1.0 - 2023-08-01

### Added

- Connectivity to Azure PostgreSQL.

### Fixed

- Order by collation waterfall:
  1. ICU
  2. best-effort mapping (`xx` -> `xx_YY`, where `xx_YY` is the first match)
  3. without collation
- More stable configuration of `schema_evolution = 'auto'`.
- Log `hostname` preferrably during deployment.
- Allow overriding of pool configuration.

### Changed

- Session context variables are set as lower case instead of upper case.

## Version 1.0.1 - 2023-07-03

### Added

- `pg` profile as mentioned in documentation

### Changed

- Updated minimum required version of `@cap-js/db-service`

## Version 1.0.0 - 2023-06-23

- Initial Release
