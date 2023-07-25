# Change Log

- All notable changes to this project are documented in this file.
- The format is based on [Keep a Changelog](http://keepachangelog.com/).
- This project adheres to [Semantic Versioning](http://semver.org/).

## Version 1.1.0 - tbd

### Added

- connectivity to Azure PostgreSQL

### Fixed

- Order by collation waterfall:
  1. ICU
  2. best-effort mapping (`xx` -> `xx_YY`, where `xx_YY` is the first match)
  3. without collation

## Version 1.0.1 - 2023-07-03

### Added

- `pg` profile as mentioned in documentation

### Changed

- Updated minimum required version of `@cap-js/db-service` 

## Version 1.0.0 - 2023-06-23

- Initial Release
