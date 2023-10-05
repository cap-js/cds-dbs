# Change Log

- All notable changes to this project are documented in this file.
- The format is based on [Keep a Changelog](http://keepachangelog.com/).
- This project adheres to [Semantic Versioning](http://semver.org/).

### Version 1.3.0 - 2023-10-05

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
