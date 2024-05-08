# Changelog

- All notable changes to this project are documented in this file.
- The format is based on [Keep a Changelog](http://keepachangelog.com/).
- This project adheres to [Semantic Versioning](http://semver.org/).

## [0.3.0](https://github.com/cap-js/cds-dbs/compare/hana-v0.2.0...hana-v0.3.0) (2024-05-08)


### Added

* select decimals as strings if cds.env.features.string_decimals ([#616](https://github.com/cap-js/cds-dbs/issues/616)) ([39addbf](https://github.com/cap-js/cds-dbs/commit/39addbfe01da757d86a4d65e62eda86e59fc9b87))


### Fixed

* Add multi `concat` function to `@cap-js/hana` ([#624](https://github.com/cap-js/cds-dbs/issues/624)) ([df436fe](https://github.com/cap-js/cds-dbs/commit/df436fec3e137dee81f4a5ed69e551fc7c92700e))
* Align all quote functions with @sap/cds-compiler ([#619](https://github.com/cap-js/cds-dbs/issues/619)) ([42e9828](https://github.com/cap-js/cds-dbs/commit/42e9828baf11ec55281ea634ce56ce93e6741b91))
* Change `sql` property to `query` for errors ([#611](https://github.com/cap-js/cds-dbs/issues/611)) ([585577a](https://github.com/cap-js/cds-dbs/commit/585577a9817e7749fb71958c26c4bfa20981c663))
* Disconnect HANA tenant when deleted ([#589](https://github.com/cap-js/cds-dbs/issues/589)) ([a107db9](https://github.com/cap-js/cds-dbs/commit/a107db9dc0ce610ba07a4562e94cfd22a9f8c182))
* **hana:** Align not found behavior in @cap-js/hana ([#603](https://github.com/cap-js/cds-dbs/issues/603)) ([54d2efb](https://github.com/cap-js/cds-dbs/commit/54d2efb00cfa4b5f188dc01bd350f3ccaca8986b))
* **hana:** Allow custom fuzzy search cqn ([#620](https://github.com/cap-js/cds-dbs/issues/620)) ([80383f0](https://github.com/cap-js/cds-dbs/commit/80383f0e5aa3a81592e804c02ce6253bd4e7d16e))
* **hana:** Allow HANA to use != and == inside xpr combinations ([#607](https://github.com/cap-js/cds-dbs/issues/607)) ([c578e9f](https://github.com/cap-js/cds-dbs/commit/c578e9fd530ddd0de6e693b2bfe777935e935772))
* **hana:** Reference column alias in order by ([#615](https://github.com/cap-js/cds-dbs/issues/615)) ([7cd3a26](https://github.com/cap-js/cds-dbs/commit/7cd3a26943e9babdee385916d33e6ae16f48bd5d))
* **hana:** Remove encoding from hana-client streams ([#623](https://github.com/cap-js/cds-dbs/issues/623)) ([fed8f6f](https://github.com/cap-js/cds-dbs/commit/fed8f6f36c5d97b664852a79050ce0a5e35a5c6d))
* **hana:** Support associations with static values ([#604](https://github.com/cap-js/cds-dbs/issues/604)) ([05babcf](https://github.com/cap-js/cds-dbs/commit/05babcf7581b651b74b3f5eb1ebcb45dea706b06))
* improved `=` and `!=` with val `null` for HANA and Postgres ([#626](https://github.com/cap-js/cds-dbs/issues/626)) ([cbcfe3b](https://github.com/cap-js/cds-dbs/commit/cbcfe3b15e8ebcf7e844dc5406e4bc228d4c94c9))
* Improved placeholders and limit clause ([#567](https://github.com/cap-js/cds-dbs/issues/567)) ([d5d5dbb](https://github.com/cap-js/cds-dbs/commit/d5d5dbb7219bcef6134440715cf756fdd439f076))
* Use json datatype for Postgres insert ([#582](https://github.com/cap-js/cds-dbs/issues/582)) ([f1c9c89](https://github.com/cap-js/cds-dbs/commit/f1c9c89036a7f8e4709c67d713d06926630aa36d))

## [0.2.0](https://github.com/cap-js/cds-dbs/compare/hana-v0.1.0...hana-v0.2.0) (2024-04-12)


### Added

* Odata built-in query functions ([#558](https://github.com/cap-js/cds-dbs/issues/558)) ([6e63367](https://github.com/cap-js/cds-dbs/commit/6e6336757129c4a9dac56f93fd768bb41d071c46))
* support HANA stored procedures ([#542](https://github.com/cap-js/cds-dbs/issues/542)) ([52a00a0](https://github.com/cap-js/cds-dbs/commit/52a00a0d642ba3c58dcad97b3ea1456f1bf3b04a))

## [0.1.0](https://github.com/cap-js/cds-dbs/compare/hana-v0.0.6...hana-v0.1.0) (2024-03-22)


### Added

* also support lowercase matchespattern function ([#528](https://github.com/cap-js/cds-dbs/issues/528)) ([6ea574e](https://github.com/cap-js/cds-dbs/commit/6ea574ee67ef5e42e4f8ccbe4fe91b46097de129))
* forUpdate and forShareLock ([#148](https://github.com/cap-js/cds-dbs/issues/148)) ([99a1170](https://github.com/cap-js/cds-dbs/commit/99a1170e61de4fd0c505834c25a9c03fc34da85b))
* **hana:** drop prepared statements after end of transaction ([#537](https://github.com/cap-js/cds-dbs/issues/537)) ([b1f864e](https://github.com/cap-js/cds-dbs/commit/b1f864e0a3a0e5efacd803d3709379cab76d61cc))


### Fixed

* use keyword list from compiler ([#525](https://github.com/cap-js/cds-dbs/issues/525)) ([c6993d9](https://github.com/cap-js/cds-dbs/commit/c6993d9c0e823d403f49f55cfcfa8663971293c8))
* improve search inside where clause detection ([#538](https://github.com/cap-js/cds-dbs/issues/538)) ([51b8af3](https://github.com/cap-js/cds-dbs/commit/51b8af3b42fba3f7b509d00675997d6c711cacc4))
* reduce service manager calls for failing tenants ([#533](https://github.com/cap-js/cds-dbs/issues/533)) ([e95fd17](https://github.com/cap-js/cds-dbs/commit/e95fd176094ac8b1d95b3bc68538057bf28aadf1))
* Add views with parameters support ([#488](https://github.com/cap-js/cds-dbs/issues/488)) ([3790ec0](https://github.com/cap-js/cds-dbs/commit/3790ec0178aab2cdb429272bb3e813b13441785c))
* issue with reused select cqns ([#505](https://github.com/cap-js/cds-dbs/issues/505)) ([916d175](https://github.com/cap-js/cds-dbs/commit/916d1756422f0caf02c323052f2addafed39182a))
* joins without columns are rejected ([#535](https://github.com/cap-js/cds-dbs/issues/535)) ([eb9beda](https://github.com/cap-js/cds-dbs/commit/eb9beda728de60081d7afbfcd49305eeb241f3fb))
* mass insert for unknown entities ([#540](https://github.com/cap-js/cds-dbs/issues/540)) ([f2ea4af](https://github.com/cap-js/cds-dbs/commit/f2ea4affe65e76fa269766d3d02337ceb1138c65))

### Changed

* this package now requires `@cap-js/db-service >= v1.7.0` ([#545](https://github.com/cap-js/cds-dbs/issues/545)) ([2cec27d](https://github.com/cap-js/cds-dbs/commit/2cec27d91402804c3b2da25cc7169f0d81a7406a))

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
