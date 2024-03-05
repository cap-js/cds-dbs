# Changelog

- All notable changes to this project are documented in this file.
- The format is based on [Keep a Changelog](http://keepachangelog.com/).
- This project adheres to [Semantic Versioning](http://semver.org/).

## [0.0.6](https://github.com/cap-js/cds-dbs/compare/hana-v0.0.5...hana-v0.0.6) (2024-02-28)


### Added

* cds.Vector support for the HANAService ([#442](https://github.com/cap-js/cds-dbs/issues/442)) ([1057a13](https://github.com/cap-js/cds-dbs/commit/1057a13a9297cb1720b6faaf107bb3116a8c4a3e))


### Fixed

* `TypeError` for `cds bind` in MTX scenario ([#482](https://github.com/cap-js/cds-dbs/issues/482)) ([38722fe](https://github.com/cap-js/cds-dbs/commit/38722fe7d7df9b2c9d622e969d528be205df383a))
* Allow SELECT.join queries again with full infer call ([#469](https://github.com/cap-js/cds-dbs/issues/469)) ([5329ec0](https://github.com/cap-js/cds-dbs/commit/5329ec0a25036a1e42513e8bb9347b0ff8c7aa2d))

## [0.0.5](https://github.com/cap-js/cds-dbs/compare/hana-v0.0.4...hana-v0.0.5) (2024-02-16)


### Fixed

* **`sqlite`:** Retain Error object for unique constraint violation ([#446](https://github.com/cap-js/cds-dbs/issues/446)) ([d27ee79](https://github.com/cap-js/cds-dbs/commit/d27ee79b4c4eea8522bf5dd2a288638f54029567))
* **hana:** ensure the database connection does not enable auto commit ([#448](https://github.com/cap-js/cds-dbs/issues/448)) ([b2ca1da](https://github.com/cap-js/cds-dbs/commit/b2ca1da4fa1976cd2ac16d2bb831719cf9ba8424))
* **hana:** Ensure xpr with logical operator to only contain comparisons  ([#452](https://github.com/cap-js/cds-dbs/issues/452)) ([a2ecb22](https://github.com/cap-js/cds-dbs/commit/a2ecb22fb587bf5364e035f679851610ede58e20))
* ignore virtual keys in UPSERT([#463](https://github.com/cap-js/cds-dbs/issues/463)) ([49adbf3](https://github.com/cap-js/cds-dbs/commit/49adbf35f243d6365f84a8cf0193f028798aa366))
* select without columns from unknown entity ([#466](https://github.com/cap-js/cds-dbs/issues/466)) ([eb857de](https://github.com/cap-js/cds-dbs/commit/eb857def41a89e9afe5e72686c3e55273c983b98))

## [0.0.4](https://github.com/cap-js/cds-dbs/compare/hana-v0.0.3...hana-v0.0.4) (2024-02-02)


### Added

* Add fallback for @cap-js/hana for unknown entities ([#403](https://github.com/cap-js/cds-dbs/issues/403)) ([e7dd6de](https://github.com/cap-js/cds-dbs/commit/e7dd6de4ef65881ef66f7ba9c164ff2b4e9b1111))
* SELECT returns binaries as Buffers ([#416](https://github.com/cap-js/cds-dbs/issues/416)) ([d4240d5](https://github.com/cap-js/cds-dbs/commit/d4240d5efb7789851593c83a430e601d6ff87118))
* SELECT returns LargeBinaries as streams unless feature flag "stream_compat" is set ([#251](https://github.com/cap-js/cds-dbs/issues/251)) ([8165a4a](https://github.com/cap-js/cds-dbs/commit/8165a4a3f6bb21c970668c8873f9d9c662b43780))
* Support Readable Streams inside INSERT.entries ([#343](https://github.com/cap-js/cds-dbs/issues/343)) ([f6faf89](https://github.com/cap-js/cds-dbs/commit/f6faf8955b7888479c66f1727ade65b382611c2f))


### Fixed

* Ensure globally unique aliases with large expand queries ([#396](https://github.com/cap-js/cds-dbs/issues/396)) ([c1df747](https://github.com/cap-js/cds-dbs/commit/c1df747e54f3ac224ec98d44cb72315aabe9e16a))
* enumeration issue with session context in @cap-js/hana ([#399](https://github.com/cap-js/cds-dbs/issues/399)) ([8106a20](https://github.com/cap-js/cds-dbs/commit/8106a207543be700d37b1f1b510d00d5dd1370e4))
* ignore empty order by ([#392](https://github.com/cap-js/cds-dbs/issues/392)) ([a69fed0](https://github.com/cap-js/cds-dbs/commit/a69fed01c4ff6c503ec58b5c7997ef1fc1dd5e86))
* improve `!=` and `==` implementation for @cap-js/hana ([#426](https://github.com/cap-js/cds-dbs/issues/426)) ([9b7b5a0](https://github.com/cap-js/cds-dbs/commit/9b7b5a09b2fd4bbc9e28ba3f73afb41941c011d3))
* show clear error message when unable to load project package.json ([#419](https://github.com/cap-js/cds-dbs/issues/419)) ([2ebf783](https://github.com/cap-js/cds-dbs/commit/2ebf783de0ce044323a3ac54a0cac0e5485e360d))
* UPSERT for @cap-js/hana for entities with multiple keys ([#418](https://github.com/cap-js/cds-dbs/issues/418)) ([9bbac6e](https://github.com/cap-js/cds-dbs/commit/9bbac6ebbbddfa2f620833ce195eedeb0a79f43e))

## [0.0.3](https://github.com/cap-js/cds-dbs/compare/hana-v0.0.2...hana-v0.0.3) (2023-12-20)


### Added

* Compress HANA expand queries by reducing duplicated statements ([#383](https://github.com/cap-js/cds-dbs/issues/383)) ([3d29351](https://github.com/cap-js/cds-dbs/commit/3d293513fc2915a4727020e2e3bdf2cf97805200))


### Fixed

* **cqn2sql:** supporting calculated elements ([#387](https://github.com/cap-js/cds-dbs/issues/387)) ([2153fb9](https://github.com/cap-js/cds-dbs/commit/2153fb9a3910cd4afa3a91918e6cf682646492b7))


### Performance Improvements

* HANA list placeholder ([#380](https://github.com/cap-js/cds-dbs/issues/380)) ([3eadfea](https://github.com/cap-js/cds-dbs/commit/3eadfea7b94f485030cc8bd0bd298ce088586422))

## [0.0.2](https://github.com/cap-js/cds-dbs/compare/hana-v0.0.1...hana-v0.0.2) (2023-12-11)


### Fixed

* add missing mappings for hdb driver ([#375](https://github.com/cap-js/cds-dbs/issues/375)) ([199a720](https://github.com/cap-js/cds-dbs/commit/199a72052f7e6d9c8d4c473a6245440f8e44b522))

## 0.0.1 (2023-12-06)

- Initial alpha release
