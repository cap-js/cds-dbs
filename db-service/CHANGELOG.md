# Change Log

- All notable changes to this project are documented in this file.
- The format is based on [Keep a Changelog](http://keepachangelog.com/).
- This project adheres to [Semantic Versioning](http://semver.org/).

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
