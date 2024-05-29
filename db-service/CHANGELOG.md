# Changelog

- All notable changes to this project are documented in this file.
- The format is based on [Keep a Changelog](http://keepachangelog.com/).
- This project adheres to [Semantic Versioning](http://semver.org/).

## [1.9.2](https://github.com/cap-js/cds-dbs/compare/db-service-v1.9.1...db-service-v1.9.2) (2024-05-28)


### Fixed

* do not prepend table alias to session variables ([#656](https://github.com/cap-js/cds-dbs/issues/656)) ([24e8b19](https://github.com/cap-js/cds-dbs/commit/24e8b1995aff3ea971e22849d2f85605f45b0a26))

## [1.9.1](https://github.com/cap-js/cds-dbs/compare/db-service-v1.9.0...db-service-v1.9.1) (2024-05-16)


### Fixed

* dont mistake non-key access with foreign key ([#642](https://github.com/cap-js/cds-dbs/issues/642)) ([2cd2349](https://github.com/cap-js/cds-dbs/commit/2cd234994d6a9e99765e56f7548a42a35279a790))

## [1.9.0](https://github.com/cap-js/cds-dbs/compare/db-service-v1.8.0...db-service-v1.9.0) (2024-05-08)


### Added

* Add missing `func` cqn structures ([#629](https://github.com/cap-js/cds-dbs/issues/629)) ([9d7539a](https://github.com/cap-js/cds-dbs/commit/9d7539ab0fc7e70a6a00c0bd9cb4b3e362976e16))


### Fixed

* **`order by`:** reject non-fk traversals of own columns in order by ([#599](https://github.com/cap-js/cds-dbs/issues/599)) ([3288d63](https://github.com/cap-js/cds-dbs/commit/3288d63f0ee6a96580a3b2138ecb24a944371cf1))
* Align all quote functions with @sap/cds-compiler ([#619](https://github.com/cap-js/cds-dbs/issues/619)) ([42e9828](https://github.com/cap-js/cds-dbs/commit/42e9828baf11ec55281ea634ce56ce93e6741b91))
* assign artificial alias if selecting from anonymous subquery ([#608](https://github.com/cap-js/cds-dbs/issues/608)) ([e1a7711](https://github.com/cap-js/cds-dbs/commit/e1a77119f0a5241cfe4f50a37a473f2325ba5bde))
* avoid spread operator ([#630](https://github.com/cap-js/cds-dbs/issues/630)) ([a39fb65](https://github.com/cap-js/cds-dbs/commit/a39fb65f9419fe60e0324741039d004b40082903))
* flat update with arbitrary where clauses ([#598](https://github.com/cap-js/cds-dbs/issues/598)) ([f108798](https://github.com/cap-js/cds-dbs/commit/f108798c6c8035f9cdd0b9c6b8f334f1454c2faa))
* improved `=` and `!=` with val `null` ([#626](https://github.com/cap-js/cds-dbs/issues/626)) ([cbcfe3b](https://github.com/cap-js/cds-dbs/commit/cbcfe3b15e8ebcf7e844dc5406e4bc228d4c94c9))
* Improved placeholders and limit clause ([#567](https://github.com/cap-js/cds-dbs/issues/567)) ([d5d5dbb](https://github.com/cap-js/cds-dbs/commit/d5d5dbb7219bcef6134440715cf756fdd439f076))
* multiple result responses ([#602](https://github.com/cap-js/cds-dbs/issues/602)) ([bf0bed4](https://github.com/cap-js/cds-dbs/commit/bf0bed4549fe816e35481b0c9a7547a522a5a593))
* only consider persisted columns for simple operations ([#592](https://github.com/cap-js/cds-dbs/issues/592)) ([6e31bda](https://github.com/cap-js/cds-dbs/commit/6e31bda1bb15b1770b75c8971773806a26f7d452))


### Changed

* require `>= sap/cds@7.9.0` ([#627](https://github.com/cap-js/cds-dbs/issues/627)) ([f4d09e2](https://github.com/cap-js/cds-dbs/commit/f4d09e27c3b07dd88925e196aefc1087d8357f7a))

## [1.8.0](https://github.com/cap-js/cds-dbs/compare/db-service-v1.7.0...db-service-v1.8.0) (2024-04-12)


### Added

* Odata built-in query functions ([#558](https://github.com/cap-js/cds-dbs/issues/558)) ([6e63367](https://github.com/cap-js/cds-dbs/commit/6e6336757129c4a9dac56f93fd768bb41d071c46))
* support HANA stored procedures ([#542](https://github.com/cap-js/cds-dbs/issues/542)) ([52a00a0](https://github.com/cap-js/cds-dbs/commit/52a00a0d642ba3c58dcad97b3ea1456f1bf3b04a))


### Fixed

* **`expand`:** Only accept on structures, assocs or table aliases ([#551](https://github.com/cap-js/cds-dbs/issues/551)) ([3248512](https://github.com/cap-js/cds-dbs/commit/32485129147cd1b376f1d2faf2ea7c7232ba3794))
* **`order by`:** for localized sorting, prepend table alias ([#546](https://github.com/cap-js/cds-dbs/issues/546)) ([a273a92](https://github.com/cap-js/cds-dbs/commit/a273a9278b2551ed3381795effe28cf8de41b1bd))
* etag with stream_compat ([#562](https://github.com/cap-js/cds-dbs/issues/562)) ([b0a3a41](https://github.com/cap-js/cds-dbs/commit/b0a3a418fbcff7eb7e7b8fa4ff031e1c0c0faac4))
* exclude `cds.LargeBinary` from wildcard expansion ([#577](https://github.com/cap-js/cds-dbs/issues/577)) ([6661d63](https://github.com/cap-js/cds-dbs/commit/6661d635b2895a13d47e42495acf6fbd7247c535))
* Reduce insert queries for deep update ([#568](https://github.com/cap-js/cds-dbs/issues/568)) ([55e5114](https://github.com/cap-js/cds-dbs/commit/55e511471743c0445d41e8297f5530abe167a270))
* Reduced count query complexity when possible ([#553](https://github.com/cap-js/cds-dbs/issues/553)) ([3331f02](https://github.com/cap-js/cds-dbs/commit/3331f0224f02bd2e6cc9c6d2cd5f1c37a36ec8dd))

## [1.7.0](https://github.com/cap-js/cds-dbs/compare/db-service-v1.6.4...db-service-v1.7.0) (2024-03-22)


### Added

* also support lowercase matchespattern function ([#528](https://github.com/cap-js/cds-dbs/issues/528)) ([6ea574e](https://github.com/cap-js/cds-dbs/commit/6ea574ee67ef5e42e4f8ccbe4fe91b46097de129))
* forUpdate and forShareLock ([#148](https://github.com/cap-js/cds-dbs/issues/148)) ([99a1170](https://github.com/cap-js/cds-dbs/commit/99a1170e61de4fd0c505834c25a9c03fc34da85b))
* **hana:** drop prepared statements after end of transaction ([#537](https://github.com/cap-js/cds-dbs/issues/537)) ([b1f864e](https://github.com/cap-js/cds-dbs/commit/b1f864e0a3a0e5efacd803d3709379cab76d61cc))
* **hana:** Add views with parameters support ([#488](https://github.com/cap-js/cds-dbs/issues/488)) ([3790ec0](https://github.com/cap-js/cds-dbs/commit/3790ec0178aab2cdb429272bb3e813b13441785c))
* **orderby:** allow to disable collations with [@cds](https://github.com/cds).collate: false ([#492](https://github.com/cap-js/cds-dbs/issues/492)) ([820f971](https://github.com/cap-js/cds-dbs/commit/820f971e1ad21fa8f8ca289c1e29b373365df484))


### Fixed

* **cqn2sql:** Smart quoting of columns inside UPSERT rows ([#519](https://github.com/cap-js/cds-dbs/issues/519)) ([78fe10b](https://github.com/cap-js/cds-dbs/commit/78fe10b1df3691614dc77b1d4f82df10a1d641d3))
* Getting rid of quirks mode ([#514](https://github.com/cap-js/cds-dbs/issues/514)) ([c9aa6e8](https://github.com/cap-js/cds-dbs/commit/c9aa6e835761ace38447f37cad6a5f39cb0b910c))
* issue with reused select cqns ([#505](https://github.com/cap-js/cds-dbs/issues/505)) ([916d175](https://github.com/cap-js/cds-dbs/commit/916d1756422f0caf02c323052f2addafed39182a))
* joins without columns are rejected ([#535](https://github.com/cap-js/cds-dbs/issues/535)) ([eb9beda](https://github.com/cap-js/cds-dbs/commit/eb9beda728de60081d7afbfcd49305eeb241f3fb))
* **search:** dont search non string aggregations ([#527](https://github.com/cap-js/cds-dbs/issues/527)) ([c87900c](https://github.com/cap-js/cds-dbs/commit/c87900cb157041a6ff76c45192c1d33180840d0f))
* **search:** search on aggregated results in HAVING clause  ([#524](https://github.com/cap-js/cds-dbs/issues/524)) ([61d348e](https://github.com/cap-js/cds-dbs/commit/61d348ebc2528b7f1c6da8c78a7455a438e1b7cf))

## [1.6.4](https://github.com/cap-js/cds-dbs/compare/db-service-v1.6.3...db-service-v1.6.4) (2024-02-28)


### Fixed

* **`cqn2sql`:** smart quoting also for update statements ([#475](https://github.com/cap-js/cds-dbs/issues/475)) ([1688f77](https://github.com/cap-js/cds-dbs/commit/1688f77158c2df37673e969074f1b6d210267336))
* `INSERT` with first `undefined` value ([#484](https://github.com/cap-js/cds-dbs/issues/484)) ([c21e3c4](https://github.com/cap-js/cds-dbs/commit/c21e3c44140c44ff6378d1fdac32869d9c1c988c))
* Allow SELECT.join queries again with full infer call ([#469](https://github.com/cap-js/cds-dbs/issues/469)) ([5329ec0](https://github.com/cap-js/cds-dbs/commit/5329ec0a25036a1e42513e8bb9347b0ff8c7aa2d))
* optimize foreign key access in a join relevant path ([#481](https://github.com/cap-js/cds-dbs/issues/481)) ([5e30de4](https://github.com/cap-js/cds-dbs/commit/5e30de439b62167c4b6d487c4d5cda4f2f0a806d)), closes [#479](https://github.com/cap-js/cds-dbs/issues/479)

## [1.6.3](https://github.com/cap-js/cds-dbs/compare/db-service-v1.6.2...db-service-v1.6.3) (2024-02-20)


### Fixed

* **`cqn4sql`:** be robust against `$self.<element>;` references ([#471](https://github.com/cap-js/cds-dbs/issues/471)) ([2921b0e](https://github.com/cap-js/cds-dbs/commit/2921b0e8ada33b172a001d89904893268e751efd))
* **`infer`:** Always use srv.model ([#451](https://github.com/cap-js/cds-dbs/issues/451)) ([41cf4a2](https://github.com/cap-js/cds-dbs/commit/41cf4a24cf2f5e2411be0dc647af6eb628a6d312))
* Throw 'new Error' instead of string on $search with multiple words ([#472](https://github.com/cap-js/cds-dbs/issues/472)) ([51be94d](https://github.com/cap-js/cds-dbs/commit/51be94d2333b4a4007f354c805d1b974b19d6d2d))

## [1.6.2](https://github.com/cap-js/cds-dbs/compare/db-service-v1.6.1...db-service-v1.6.2) (2024-02-16)


### Fixed

* ** `infer`:** unique alias for scoped subqueries ([#465](https://github.com/cap-js/cds-dbs/issues/465)) ([5dbaa8e](https://github.com/cap-js/cds-dbs/commit/5dbaa8e414102ee1dd0d8f76058c9eeff899666e))
* Allow only for array of arrays as data for plain SQL ([#449](https://github.com/cap-js/cds-dbs/issues/449)) ([22e1c43](https://github.com/cap-js/cds-dbs/commit/22e1c43c38709c6597be9e642619476338ef824a))
* dont insert structured elements ([#461](https://github.com/cap-js/cds-dbs/issues/461)) ([f3f688d](https://github.com/cap-js/cds-dbs/commit/f3f688d6ef45f9d42690c13eaf88ab004aa86ff9))
* ignore virtual keys in UPSERT([#463](https://github.com/cap-js/cds-dbs/issues/463)) ([49adbf3](https://github.com/cap-js/cds-dbs/commit/49adbf35f243d6365f84a8cf0193f028798aa366))
* INSERT entries containing undefined values ([#453](https://github.com/cap-js/cds-dbs/issues/453)) ([d3aad75](https://github.com/cap-js/cds-dbs/commit/d3aad7580f45ccde8528ddfa261f81d155354574))
* select without columns from unknown entity ([#466](https://github.com/cap-js/cds-dbs/issues/466)) ([eb857de](https://github.com/cap-js/cds-dbs/commit/eb857def41a89e9afe5e72686c3e55273c983b98))

## [1.6.1](https://github.com/cap-js/cds-dbs/compare/db-service-v1.6.0...db-service-v1.6.1) (2024-02-05)


### Fixed

* consider leafs in `ref` with filter (→ `.id`) for alias calculation ([#440](https://github.com/cap-js/cds-dbs/issues/440)) ([3e2ef24](https://github.com/cap-js/cds-dbs/commit/3e2ef2429701f37853117c0f902a198aded767d9))

## [1.6.0](https://github.com/cap-js/cds-dbs/compare/db-service-v1.5.1...db-service-v1.6.0) (2024-02-02)


### Added

* Add fallback for @cap-js/hana for unknown entities ([#403](https://github.com/cap-js/cds-dbs/issues/403)) ([e7dd6de](https://github.com/cap-js/cds-dbs/commit/e7dd6de4ef65881ef66f7ba9c164ff2b4e9b1111))
* SELECT returns binaries as Buffers ([#416](https://github.com/cap-js/cds-dbs/issues/416)) ([d4240d5](https://github.com/cap-js/cds-dbs/commit/d4240d5efb7789851593c83a430e601d6ff87118))
* SELECT returns LargeBinaries as streams unless feature flag "stream_compat" is set ([#251](https://github.com/cap-js/cds-dbs/issues/251)) ([8165a4a](https://github.com/cap-js/cds-dbs/commit/8165a4a3f6bb21c970668c8873f9d9c662b43780))
* strict mode to validate input for `INSERT`, `UPDATE` and `UPSERT` ([#384](https://github.com/cap-js/cds-dbs/issues/384)) ([4644483](https://github.com/cap-js/cds-dbs/commit/464448384145d934933c473ae2f20d49cc75554d))
* Support Readable Streams inside INSERT.entries ([#343](https://github.com/cap-js/cds-dbs/issues/343)) ([f6faf89](https://github.com/cap-js/cds-dbs/commit/f6faf8955b7888479c66f1727ade65b382611c2f))


### Fixed

* **`cqn4sql`:** only transform list if necessary ([#438](https://github.com/cap-js/cds-dbs/issues/438)) ([8a7ec65](https://github.com/cap-js/cds-dbs/commit/8a7ec65fe46c2dae668bb536671943a76d5e8206))
* always generate unique subquery aliases ([#435](https://github.com/cap-js/cds-dbs/issues/435)) ([c875b7d](https://github.com/cap-js/cds-dbs/commit/c875b7d07a83693febb2543d202fd53b43172f7b))
* consider `list` in `from.where` ([#429](https://github.com/cap-js/cds-dbs/issues/429)) ([3288e94](https://github.com/cap-js/cds-dbs/commit/3288e943f53a2ba08d97018e016c06932b5c8f88))
* **cqn2sql:** $user.locale refs ([#431](https://github.com/cap-js/cds-dbs/issues/431)) ([ec55276](https://github.com/cap-js/cds-dbs/commit/ec55276409ccd56d8b831bbff3d3915e078d3f72))
* **cqn4sql:** expand structured keys in on-conditions ([#421](https://github.com/cap-js/cds-dbs/issues/421)) ([b1e0677](https://github.com/cap-js/cds-dbs/commit/b1e06777ccfce80f50443e61a10ae5d86c6bc232))
* Do not generate UUIDs for association keys ([#398](https://github.com/cap-js/cds-dbs/issues/398)) ([9970e14](https://github.com/cap-js/cds-dbs/commit/9970e14352679711a9c60807608becff05151fc4))
* enumeration issue with session context in @cap-js/hana ([#399](https://github.com/cap-js/cds-dbs/issues/399)) ([8106a20](https://github.com/cap-js/cds-dbs/commit/8106a207543be700d37b1f1b510d00d5dd1370e4))
* make @cap-js/sqlite work with better-sqlite3@9.3.0 ([#422](https://github.com/cap-js/cds-dbs/issues/422)) ([44c0a59](https://github.com/cap-js/cds-dbs/commit/44c0a59277b14be0b81b7f80555e18377ddbfe3c))
* pass context of navigation for list within infix filter ([#433](https://github.com/cap-js/cds-dbs/issues/433)) ([0ca077f](https://github.com/cap-js/cds-dbs/commit/0ca077f071a1569fa3b46f6ccfb003feaebd1ea0))
* Restore former deep upsert behavior / error ([#406](https://github.com/cap-js/cds-dbs/issues/406)) ([284b1e3](https://github.com/cap-js/cds-dbs/commit/284b1e3a605957d91dd867794ab1a7dcdf345c40))
* Skip virtual fields on UPSERTs ([#405](https://github.com/cap-js/cds-dbs/issues/405)) ([1a05dcb](https://github.com/cap-js/cds-dbs/commit/1a05dcb1d032a85e826c76f5a8a710161fa2b679))
* sqlite date string compatibility parsing only for valid dates ([#410](https://github.com/cap-js/cds-dbs/issues/410)) ([2a8bb2d](https://github.com/cap-js/cds-dbs/commit/2a8bb2d60940760c6280d8cc06100cb9087194b5)), closes [#409](https://github.com/cap-js/cds-dbs/issues/409)
* UPSERT for @cap-js/hana for entities with multiple keys ([#418](https://github.com/cap-js/cds-dbs/issues/418)) ([9bbac6e](https://github.com/cap-js/cds-dbs/commit/9bbac6ebbbddfa2f620833ce195eedeb0a79f43e))

## [1.5.1](https://github.com/cap-js/cds-dbs/compare/db-service-v1.5.0...db-service-v1.5.1) (2023-12-20)


### Fixed

* **cqn2sql:** supporting calculated elements ([#387](https://github.com/cap-js/cds-dbs/issues/387)) ([2153fb9](https://github.com/cap-js/cds-dbs/commit/2153fb9a3910cd4afa3a91918e6cf682646492b7))
* do not rely on db constraints for deep delete ([#390](https://github.com/cap-js/cds-dbs/issues/390)) ([9623af6](https://github.com/cap-js/cds-dbs/commit/9623af64db97cfe15ef07b659635850fc908f77c))


### Performance Improvements

* HANA list placeholder ([#380](https://github.com/cap-js/cds-dbs/issues/380)) ([3eadfea](https://github.com/cap-js/cds-dbs/commit/3eadfea7b94f485030cc8bd0bd298ce088586422))

## [1.5.0](https://github.com/cap-js/cds-dbs/compare/db-service-v1.4.0...db-service-v1.5.0) (2023-12-06)


### Added

* Improved connection pool for HANAService ([#349](https://github.com/cap-js/cds-dbs/issues/349)) ([1c284e6](https://github.com/cap-js/cds-dbs/commit/1c284e69cccd76daad52249c0462bc62aa4d11a8))


### Fixed

* **localized:** `ref`s in subqueries in `from` are translated ([#366](https://github.com/cap-js/cds-dbs/issues/366)) ([cfe4897](https://github.com/cap-js/cds-dbs/commit/cfe489715db0854d30b90b7f13c024e6e90be497))
* wrong odata count in filter with groupby ([#352](https://github.com/cap-js/cds-dbs/issues/352)) ([70690a1](https://github.com/cap-js/cds-dbs/commit/70690a1a13e72bfbb66f03bf315d3f2d48672bf6))

## [1.4.0](https://github.com/cap-js/cds-dbs/compare/db-service-v1.3.2...db-service-v1.4.0) (2023-11-20)


### Added

* **`UPDATE`/`DELETE`:** Enable path expressions for improved data manipulation ([#325](https://github.com/cap-js/cds-dbs/issues/325)) ([94f0776](https://github.com/cap-js/cds-dbs/commit/94f077661cffad8f137dc692a2cb9b0ae5e4d75b))
* **temporal data:** add time slice key to conflict clause ([#249](https://github.com/cap-js/cds-dbs/issues/249)) ([67b8edf](https://github.com/cap-js/cds-dbs/commit/67b8edf9b7f6b0fbab0010d7c93ed03a01e103ed))
* use place holders for update and delete ([#323](https://github.com/cap-js/cds-dbs/issues/323)) ([81472b9](https://github.com/cap-js/cds-dbs/commit/81472b971183f701e401247611310be56745a87a))


### Fixed

* align time function behavior ([#322](https://github.com/cap-js/cds-dbs/issues/322)) ([c3ab40a](https://github.com/cap-js/cds-dbs/commit/c3ab40a007c105465349dd2f612178367b8e713a))
* **calculated elements:** path expressions in `func.args` within `xpr` ([#321](https://github.com/cap-js/cds-dbs/issues/321)) ([cee25e3](https://github.com/cap-js/cds-dbs/commit/cee25e33cf289592a87779cfa34dddc53e467676))
* Disconnect db service on shutdown ([#327](https://github.com/cap-js/cds-dbs/issues/327)) ([8471bda](https://github.com/cap-js/cds-dbs/commit/8471bda44fc030205abec45b1581b2cf6ed7c800))
* non-fk access in filter conditions are properly rejected ([#336](https://github.com/cap-js/cds-dbs/issues/336)) ([4c948fe](https://github.com/cap-js/cds-dbs/commit/4c948fecead1de562e1583886516413e131a39aa))
* **search:** check calculated columns at any depth ([#310](https://github.com/cap-js/cds-dbs/issues/310)) ([8fd6153](https://github.com/cap-js/cds-dbs/commit/8fd6153dfcd472a6d95c33faa58c4b3f96f485df))

## [1.3.2](https://github.com/cap-js/cds-dbs/compare/db-service-v1.3.1...db-service-v1.3.2) (2023-10-13)


### Fixed

- preserve $count for result of SELECT queries ([#280](https://github.com/cap-js/cds-dbs/issues/280)) ([23bef24](https://github.com/cap-js/cds-dbs/commit/23bef245e62952a57ed82afcfd238c0b294b2e9e))

## [1.3.1](https://github.com/cap-js/cds-dbs/compare/db-service-v1.3.0...db-service-v1.3.1) (2023-10-10)

### Fixed

- Error message for `search` with multiple arguments. #265

## Version 1.3.0 - 2023-10-06

### Changed

- `INSERT.into(...).rows/values()` is not allowed anymore without specifying `.columns(...)`. #209
- Deep deletion uses correlated subqueries instead of materializing the to be deleted object before. #212

### Fixed

- Various fixes for calculated elements on read. #220 #223 #233
- Don't release to pool connections twice. #243
- Syntax error in `matchesPattern` function. #237
- SELECTs with more than 50 columns does not return `null` values. #238 #261

## Version 1.2.1 - 2023-09-08

### Fixed

- Association expansion in infix filters. #213

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
