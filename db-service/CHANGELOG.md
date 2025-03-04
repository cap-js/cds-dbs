# Changelog

- All notable changes to this project are documented in this file.
- The format is based on [Keep a Changelog](http://keepachangelog.com/).
- This project adheres to [Semantic Versioning](http://semver.org/).

## [1.18.0](https://github.com/cap-js/cds-dbs/compare/db-service-v1.17.2...db-service-v1.18.0) (2025-03-04)


### Added

* query modifiers on expand `ref` are propagated to subquery ([#1049](https://github.com/cap-js/cds-dbs/issues/1049)) ([39fbadf](https://github.com/cap-js/cds-dbs/commit/39fbadf25a874f810ac2795f2e6b0a46c3678058))
* support query modifiers at leaf of from ref ([#1050](https://github.com/cap-js/cds-dbs/issues/1050)) ([500a666](https://github.com/cap-js/cds-dbs/commit/500a666a9a054dd72d6ec8ccba0c6a6ddc263cd3))


### Fixed

* `<expand>[@odata](https://github.com/odata).count` queries ([#966](https://github.com/cap-js/cds-dbs/issues/966)) ([6607a84](https://github.com/cap-js/cds-dbs/commit/6607a8404aa70f2f3f7c6c65c7e9b1c324a5230b))
* align debug log format of stmt values ([#1052](https://github.com/cap-js/cds-dbs/issues/1052)) ([93af0fe](https://github.com/cap-js/cds-dbs/commit/93af0fe5f93a0c1b91f592417b31fdb6266fdd79))
* expand + groupby may return null, dont attach `.element` ([#1042](https://github.com/cap-js/cds-dbs/issues/1042)) ([cf2e0a2](https://github.com/cap-js/cds-dbs/commit/cf2e0a215e89f9055e28d9f0984adf292e220aee))

## [1.17.2](https://github.com/cap-js/cds-dbs/compare/db-service-v1.17.1...db-service-v1.17.2) (2025-02-09)


### Fixed

* replace polynomial regex with simple string op ([#1015](https://github.com/cap-js/cds-dbs/issues/1015)) ([3fe6e6b](https://github.com/cap-js/cds-dbs/commit/3fe6e6b7f7aaf5aafb811acf2838cd1da30052a8))

## [1.17.1](https://github.com/cap-js/cds-dbs/compare/db-service-v1.17.0...db-service-v1.17.1) (2025-02-04)


### Fixed

* deep update resulting in deep delete of sub-element ([#1006](https://github.com/cap-js/cds-dbs/issues/1006)) ([ef2f817](https://github.com/cap-js/cds-dbs/commit/ef2f8175df6fc7076fa8a9290e1863f44d267d8d))
* nested $self reference to other column ([#1009](https://github.com/cap-js/cds-dbs/issues/1009)) ([41a76d8](https://github.com/cap-js/cds-dbs/commit/41a76d89a884ac8266ccbd2d087af435e8f26ccb))

## [1.17.0](https://github.com/cap-js/cds-dbs/compare/db-service-v1.16.2...db-service-v1.17.0) (2025-01-28)


### Added

* support for cds.Map ([#889](https://github.com/cap-js/cds-dbs/issues/889)) ([cde7514](https://github.com/cap-js/cds-dbs/commit/cde7514df20396383e0179ffce838596e3706bb2))


### Fixed

* **`UPDATE`:** no assocs in list which matches subquery results ([4bcb88a](https://github.com/cap-js/cds-dbs/commit/4bcb88a1f40540e26cebd4907bdd33e90d08bb9d))
* **`UPDATE`:** only perform subselect matching if necessary ([#989](https://github.com/cap-js/cds-dbs/issues/989)) ([4bcb88a](https://github.com/cap-js/cds-dbs/commit/4bcb88a1f40540e26cebd4907bdd33e90d08bb9d))
* contains not evaluting to bool ([#980](https://github.com/cap-js/cds-dbs/issues/980)) ([760484b](https://github.com/cap-js/cds-dbs/commit/760484be4cf3d0c755254e90f7740ba0b34b9249))
* nested ternary in calculated element ([#981](https://github.com/cap-js/cds-dbs/issues/981)) ([5f4a1fe](https://github.com/cap-js/cds-dbs/commit/5f4a1feed7b74bb1736f6140527e70b1e261f368))
* reject virtual elements in all expressions ([#972](https://github.com/cap-js/cds-dbs/issues/972)) ([d0c949d](https://github.com/cap-js/cds-dbs/commit/d0c949d8a3a9851ccd70b3f998caec0b5f01ce0e))
* starts endswith for null values ([#975](https://github.com/cap-js/cds-dbs/issues/975)) ([f0330bc](https://github.com/cap-js/cds-dbs/commit/f0330bc334fd3a8ed5377afcdd04b731baa8c753))
* use "$$value$$" as internal column name for UPSERT ([#976](https://github.com/cap-js/cds-dbs/issues/976)) ([8c86b86](https://github.com/cap-js/cds-dbs/commit/8c86b863a69833d50cff91483150bf0314bb7258))

## [1.16.2](https://github.com/cap-js/cds-dbs/compare/db-service-v1.16.1...db-service-v1.16.2) (2024-12-18)


### Fixed

* do not override .toJSON of buffers ([#949](https://github.com/cap-js/cds-dbs/issues/949)) ([ed52f72](https://github.com/cap-js/cds-dbs/commit/ed52f72206df6e683106ab0bbbecf4b778cf36b5))

## [1.16.1](https://github.com/cap-js/cds-dbs/compare/db-service-v1.16.0...db-service-v1.16.1) (2024-12-16)


### Fixed

* handle undefined DEBUG ([#942](https://github.com/cap-js/cds-dbs/issues/942)) ([dd2da3a](https://github.com/cap-js/cds-dbs/commit/dd2da3a8d8feb5beaae5860d493e9e1158dbf99f)), closes [#941](https://github.com/cap-js/cds-dbs/issues/941)
* only expand partial foreign key if explicitly requested ([#916](https://github.com/cap-js/cds-dbs/issues/916)) ([96911ad](https://github.com/cap-js/cds-dbs/commit/96911ada1831e71febb84d8a382b57d55d24c1bc))
* quoted mode ([#937](https://github.com/cap-js/cds-dbs/issues/937)) ([9e62b22](https://github.com/cap-js/cds-dbs/commit/9e62b22a1be90ada9f57cfa63505735d8b8eed88))
* sort property is case insensitive ([#924](https://github.com/cap-js/cds-dbs/issues/924)) ([2c72c87](https://github.com/cap-js/cds-dbs/commit/2c72c871d6c7f65797b8bd8692305149b3ea65f8))
* wildcard expand with aggregation ([#923](https://github.com/cap-js/cds-dbs/issues/923)) ([bbe7be0](https://github.com/cap-js/cds-dbs/commit/bbe7be00498ad083cf951daf344b7f5fd9f68ab9))

## [1.16.0](https://github.com/cap-js/cds-dbs/compare/db-service-v1.15.1...db-service-v1.16.0) (2024-11-25)


### Changed

* single column in `search` function is also treated as CQN `list` ([#898](https://github.com/cap-js/cds-dbs/issues/898)) ([f6593e6](https://github.com/cap-js/cds-dbs/commit/f6593e69de6df3e85a39c048794a56c7eb842c4c))


### Fixed

* foreignKeys aspect on association may not be set ([#903](https://github.com/cap-js/cds-dbs/issues/903)) ([732a2f3](https://github.com/cap-js/cds-dbs/commit/732a2f385074f50b87ff9715b8bdf48d28a36309))
* insert on uuid with default value ([#911](https://github.com/cap-js/cds-dbs/issues/911)) ([545e489](https://github.com/cap-js/cds-dbs/commit/545e489ecd07b5a3ece9441d95804fb2f3d436fa))
* `session_context`, `current_date`, `current_time` and `current_timestamp` are treated as SAP HANA functions and are callable in upper case ([#910](https://github.com/cap-js/cds-dbs/issues/910)) ([50ebd10](https://github.com/cap-js/cds-dbs/commit/50ebd106b9ee5bf7e1026658b89401e904ffe051))
* wrap values in array if it is object, so it can be spreaded ([#882](https://github.com/cap-js/cds-dbs/issues/882)) ([11f3e8b](https://github.com/cap-js/cds-dbs/commit/11f3e8bdf37d57295c1f2ffb40e217f86ec7d423))

## [1.15.1](https://github.com/cap-js/cds-dbs/compare/db-service-v1.15.0...db-service-v1.15.1) (2024-11-18)


### Fixed

* cross joins without on-condition ([#899](https://github.com/cap-js/cds-dbs/issues/899)) ([c61a04a](https://github.com/cap-js/cds-dbs/commit/c61a04aa4394511100f97cfebd362a2298221d96))
* pseudo paths in expands ([#896](https://github.com/cap-js/cds-dbs/issues/896)) ([014c50c](https://github.com/cap-js/cds-dbs/commit/014c50cec9c2de1ee3dfdf1861940ae0e2520c16))

## [1.15.0](https://github.com/cap-js/cds-dbs/compare/db-service-v1.14.1...db-service-v1.15.0) (2024-11-14)


### Added

* enable path expressions in infix filter after `exists` predicate ([#875](https://github.com/cap-js/cds-dbs/issues/875)) ([7e50359](https://github.com/cap-js/cds-dbs/commit/7e5035932ac3bf39f052aa67e1565567e9d6b1ad))


### Fixed

* **`search`:** ignore invalid path expressions inside `@cds.search` ([#849](https://github.com/cap-js/cds-dbs/issues/849)) ([250edd5](https://github.com/cap-js/cds-dbs/commit/250edd5ec9f7ba1d8e40e1330e4b4f9ad9e599b0))
* nested exists wrapped in xpr ([7e50359](https://github.com/cap-js/cds-dbs/commit/7e5035932ac3bf39f052aa67e1565567e9d6b1ad))

## [1.14.1](https://github.com/cap-js/cds-dbs/compare/db-service-v1.14.0...db-service-v1.14.1) (2024-10-28)


### Fixed

* deep delete for views ([#496](https://github.com/cap-js/cds-dbs/issues/496)) ([82154ef](https://github.com/cap-js/cds-dbs/commit/82154ef8b837f17e81e2516056e03ff215f1dff8))
* properly support `default`, `cds.on.insert` and `cds.on.update` for `UPSERT` queries ([#425](https://github.com/cap-js/cds-dbs/issues/425)) ([338e9f5](https://github.com/cap-js/cds-dbs/commit/338e9f5de9109d36013208547fc648c17ce8c7b0))
* SELECT cds.hana.BINARY ([#870](https://github.com/cap-js/cds-dbs/issues/870)) ([33c3ebe](https://github.com/cap-js/cds-dbs/commit/33c3ebe84be4c0181b1c230d5f2d332332201ce0))

## [1.14.0](https://github.com/cap-js/cds-dbs/compare/db-service-v1.13.0...db-service-v1.14.0) (2024-10-15)


### Added

* assoc-like calc elements after exists predicate ([#831](https://github.com/cap-js/cds-dbs/issues/831)) ([05f7d75](https://github.com/cap-js/cds-dbs/commit/05f7d75837495d58cc4f72ad628077bdebb0acf6))


### Fixed

* Improved behavioral consistency between the database services ([#837](https://github.com/cap-js/cds-dbs/issues/837)) ([b6f7187](https://github.com/cap-js/cds-dbs/commit/b6f718701e48dfb1c4c3d98ee016ec45930f8e7b))
* Treat assoc-like calculated elements as unmanaged assocs ([#830](https://github.com/cap-js/cds-dbs/issues/830)) ([cbe0df7](https://github.com/cap-js/cds-dbs/commit/cbe0df7a66fec0d421947767adc8621ed8bf236c))

## [1.13.0](https://github.com/cap-js/cds-dbs/compare/db-service-v1.12.1...db-service-v1.13.0) (2024-10-01)


### Added

* Add quoted mode support ([#681](https://github.com/cap-js/cds-dbs/issues/681)) ([43c7a6c](https://github.com/cap-js/cds-dbs/commit/43c7a6c1bed836a1210eb9c2ff5c7ffc0e498d76))


### Fixed

* **deep-queries:** properly return insert result ([#803](https://github.com/cap-js/cds-dbs/issues/803)) ([8d800e2](https://github.com/cap-js/cds-dbs/commit/8d800e2858f02663b8ed3845909e5891af390517))
* dont use virtual key for `UPDATE … where (&lt;key&gt;) in <subquery>` ([#800](https://github.com/cap-js/cds-dbs/issues/800)) ([d25af70](https://github.com/cap-js/cds-dbs/commit/d25af70b23688cd22c7b87f20a7848c9653ae9a9))
* reject all path expressions w/o foreign keys ([#806](https://github.com/cap-js/cds-dbs/issues/806)) ([cd271a8](https://github.com/cap-js/cds-dbs/commit/cd271a8aa973afe0926ac1fa956cc64260140b98))

## [1.12.1](https://github.com/cap-js/cds-dbs/compare/db-service-v1.12.0...db-service-v1.12.1) (2024-09-03)


### Fixed

* deep `groupby` expand queries ([#768](https://github.com/cap-js/cds-dbs/issues/768)) ([5423cf3](https://github.com/cap-js/cds-dbs/commit/5423cf38574962c09b94febab95f2e3dc118d2c9))
* **deep:** prevent false unique constraint errors and combine delete queries ([#781](https://github.com/cap-js/cds-dbs/issues/781)) ([01de95f](https://github.com/cap-js/cds-dbs/commit/01de95f5050a1d3325459ccb78a4e9a1e0dbcfde))
* **logging:** from changes in @sap/cds ([#791](https://github.com/cap-js/cds-dbs/issues/791)) ([1e8bf06](https://github.com/cap-js/cds-dbs/commit/1e8bf06c9ae92ba55d13fe9e3297d6a54c4fc8fe))
* prepend aliases to refs within function args in on conditions ([#795](https://github.com/cap-js/cds-dbs/issues/795)) ([9b34314](https://github.com/cap-js/cds-dbs/commit/9b34314d1ef8c6fd7e77451fe9bf0abdc12c27ea)), closes [#779](https://github.com/cap-js/cds-dbs/issues/779)
* prevent $search queries from throwing ([#772](https://github.com/cap-js/cds-dbs/issues/772)) ([cdf4d37](https://github.com/cap-js/cds-dbs/commit/cdf4d37590c2949cdfd6c6533370bc96cd8fd0fc))

## [1.12.0](https://github.com/cap-js/cds-dbs/compare/db-service-v1.11.0...db-service-v1.12.0) (2024-07-25)


### Fixed

* add placeholder for string values ([#733](https://github.com/cap-js/cds-dbs/issues/733)) ([8136a45](https://github.com/cap-js/cds-dbs/commit/8136a4526f596b67932908b8ab1336cb052100f3))
* for aggregated `expand` always set explicit alias ([#739](https://github.com/cap-js/cds-dbs/issues/739)) ([53a8075](https://github.com/cap-js/cds-dbs/commit/53a8075a609666a896296401a28b6183ff5aa487)), closes [#708](https://github.com/cap-js/cds-dbs/issues/708)
* quotations in vals ([#754](https://github.com/cap-js/cds-dbs/issues/754)) ([94d8e97](https://github.com/cap-js/cds-dbs/commit/94d8e977ed00776ff494287ce505d6b7e8017d2e))


### Changed

* generic-pool as real dep ([#750](https://github.com/cap-js/cds-dbs/issues/750)) ([b50c907](https://github.com/cap-js/cds-dbs/commit/b50c907880455a41a73826a736bc17ca17e5b9ae))


## [1.11.0](https://github.com/cap-js/cds-dbs/compare/db-service-v1.10.3...db-service-v1.11.0) (2024-07-08)


### Added

* **search:** enable deep search with path expressions ([#590](https://github.com/cap-js/cds-dbs/issues/590)) ([e9e9461](https://github.com/cap-js/cds-dbs/commit/e9e9461362b3a521c06075e32fb1405c8ee4dee6))

### Changed

* `search` interprets only first search term instead of raising an error ([#707](https://github.com/cap-js/cds-dbs/issues/707)) ([0b9108c](https://github.com/cap-js/cds-dbs/commit/0b9108c11a61b18704e36f93fbd654e0942bf40a))

### Fixed

* optimize foreign key access for expand with aggregations ([#734](https://github.com/cap-js/cds-dbs/issues/734)) ([77b7978](https://github.com/cap-js/cds-dbs/commit/77b79788931c9c45f156d54a4b2ec76ba9ba629a))

## [1.10.3](https://github.com/cap-js/cds-dbs/compare/db-service-v1.10.2...db-service-v1.10.3) (2024-07-05)


### Fixed

* rewrite assoc chains if intermediate assoc is not fk ([#715](https://github.com/cap-js/cds-dbs/issues/715)) ([3873f9a](https://github.com/cap-js/cds-dbs/commit/3873f9adce3ff26cafb2b18b9d2115758b0f0830))
* Support expand with group by clause ([#721](https://github.com/cap-js/cds-dbs/issues/721)) ([90c9e6a](https://github.com/cap-js/cds-dbs/commit/90c9e6a4da9d4a3451ec0ed60dd0815c04600134))

## [1.10.2](https://github.com/cap-js/cds-dbs/compare/db-service-v1.10.1...db-service-v1.10.2) (2024-06-25)


### Fixed

* **`expand`:** enable expanding from subquery ([#709](https://github.com/cap-js/cds-dbs/issues/709)) ([5ed03e5](https://github.com/cap-js/cds-dbs/commit/5ed03e5ed64eb46e6f22af120d7285fbcb127a7c)), closes [#708](https://github.com/cap-js/cds-dbs/issues/708)

## [1.10.1](https://github.com/cap-js/cds-dbs/compare/db-service-v1.10.0...db-service-v1.10.1) (2024-06-19)


### Fixed

* Only check first row if no changes required ([#552](https://github.com/cap-js/cds-dbs/issues/552)) ([39b0b85](https://github.com/cap-js/cds-dbs/commit/39b0b85d5cb4807f63f10acea13fb4d688fa1dcd))

## [1.10.0](https://github.com/cap-js/cds-dbs/compare/db-service-v1.9.2...db-service-v1.10.0) (2024-05-29)


### Added

* Add simple queries feature flag ([#660](https://github.com/cap-js/cds-dbs/issues/660)) ([3335202](https://github.com/cap-js/cds-dbs/commit/33352024201a96cc6bdfa30a0fe3fff4227dee10))

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
