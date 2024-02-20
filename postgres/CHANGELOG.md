# Changelog

- All notable changes to this project are documented in this file.
- The format is based on [Keep a Changelog](http://keepachangelog.com/).
- This project adheres to [Semantic Versioning](http://semver.org/).

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
