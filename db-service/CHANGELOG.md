# Change Log

- All notable changes to this project are documented in this file.
- The format is based on [Keep a Changelog](http://keepachangelog.com/).
- This project adheres to [Semantic Versioning](http://semver.org/).

## Version 1.X.X - 2023-XX-XX

### Added

- mapping for OData `average` function to ANSI SQL compliant `avg` function.

### Changed

### Fixed

- Paths addressing a column of the query via `$self.<column>` in `group by` / `order by`, `having` or `where`
  are now correctly substituted.

### Removed

## Version 1.0.0 - 2023-06-23

- Initial Release