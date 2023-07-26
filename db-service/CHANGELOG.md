# Change Log

- All notable changes to this project are documented in this file.
- The format is based on [Keep a Changelog](http://keepachangelog.com/).
- This project adheres to [Semantic Versioning](http://semver.org/).

## Version 1.1.0 - tbd

### Fixed

- `UPDATE` with path expressions do not end up in a dump anymore. Instead, a proper error message is emitted.
- `UPDATE` is only noop if it does not include an element annotated with `@cds.on.update`.
- `SELECT` with plain SQL statements will return correct result regardless of casing.

## Version 1.0.1 - 2023-07-03

### Fixed

- Paths addressing a column of the query via `$self.<column>` in `group by` / `order by`, `having` or `where`
  are now correctly substituted.
- Mapping for OData `average` function to ANSI SQL compliant `avg` function.

## Version 1.0.0 - 2023-06-23

- Initial Release