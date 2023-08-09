# Change Log

- All notable changes to this project are documented in this file.
- The format is based on [Keep a Changelog](http://keepachangelog.com/).
- This project adheres to [Semantic Versioning](http://semver.org/).

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
