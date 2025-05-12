# Change Log

- All notable changes to this project are documented in this file.
- The format is based on [Keep a Changelog](http://keepachangelog.com/).
- This project adheres to [Semantic Versioning](http://semver.org/).

## Version 2.0.0 - tbd

### Changed

- Change license from SAP DEVELOPER LICENSE AGREEMENT '3.1' to '3.2 CAP v2'. See https://cap.cloud.sap/resources/license/developer-license-3_2_CAP%20V2.txt.
- `@sap/cds` 8 or higher is required.
- Use UI5 version 1.135.0 by default

### Fixed

## Version 1.4.1 - 2025-04-03

### Changed

- Use UI5 version 1.133.0 by default

### Fixed

- Allow installation with upcoming cds 9

## Version 1.4.0 - 2025-03-03

### Changed

- The generated UI5 manifest prefers navigation properties over entity names to access entities (using `settings.contextPath` instead of `settings.entitySet`). This supports the new `cds.odata.containment` setting.
- Use UI5 version 1.132.0 by default

### Added

## Version 1.3.0 - 2025-01-27

### Added

- UI5 themes for Fiori preview can be configured through `cds.fiori.preview.ui5.theme.light/dark`.  Default is `sap_horizon`/`sap_horizon_dark`.
- UI5 themes for Fiori preview are automatically switched between light and dark mode.  This can be disabled with `cds.fiori.preview.ui5.theme.switch: false`.

## Version 1.2.9 - 2025-01-15

### Fixed

- Support for `cds.odata.containment`

### Changed

- Use UI5 version 1.131.0 by default

## Version 1.2.8 - 2024-11-25

### Changed

- Use UI5 version 1.130.0 by default

## Version 1.2.7 - 2024-07-08

### Fixed

- Custom protocol paths, like for OData v2 installed by `@cap-js-community/odata-v2-adapter`, are honored again.
- Services with overlapping URLs, like `/foo` and `/foo-foo`, are routed properly again.

## Version 1.2.6 - 2024-07-02

### Changed

- Use UI5 version 1.125.1 by default


## Version 1.2.5 - 2024-06-21

### Fixed

- A `400` error log is no longer written for Fiori's `.../appconfig/fioriSandboxConfig.json` request.

## Version 1.2.4 - 2024-06-14

### Changed

- Open dependency for `sap/cds` 8
- Use `better-sqlite` for own tests (through `@cap-js/sqlite`) instead of `sqlite3`

## Version 1.2.3 - 2024-02-15

### Fixed

- Handle services with multiple/no/wrong endpoints. Only show the preview link for OData endpoints.  Also fail with a proper error message if a wrong preview URL is directly called (w/o the link).

### Changed

- Use UI5 version 1.120.6 by default

## Version 1.2.2 - 2023-12-04

### Fixed

- Do not crash for services w/o a path

## Version 1.2.1 - 2023-11-27

### Fixed

- V2 proxy prefix is preferrably taken from `cds.protocols.odata-v2`
- Routing to services using odata-v4 protocol prefix

## Version 1.2.0 - 2023-11-17

### Changed

- Preview now uses SAP UI5 version 1.120.0 by default

## Version 1.1.0 - 2023-08-31

### Changed

- Fiori preview now pins the UI5 version to be more robust against unforeseen UI changes. It will get updated from time to time.
- The former config key `cds.preview.*` is no longer used.  All config is now in `cds.fiori.*`
- The UI5 version can now be configured using `cds.fiori.preview.ui5.version`.

## Version 1.0.0 - 2023-06-22

### Changed

- `@sap/cds` 7 is required at minimum

## Version 0.1.0 - 2023-06-07

### Added

- Initial release. Includes preview code for SAP Fiori Elements, formerly in `@sap/cds`.
