# Changelog

## 0.0.1 (2023-12-06)


### Added

* Improved connection pool for HANAService ([#349](https://github.com/cap-js/cds-dbs/issues/349)) ([1c284e6](https://github.com/cap-js/cds-dbs/commit/1c284e69cccd76daad52249c0462bc62aa4d11a8))
* **temporal data:** add time slice key to conflict clause ([#249](https://github.com/cap-js/cds-dbs/issues/249)) ([67b8edf](https://github.com/cap-js/cds-dbs/commit/67b8edf9b7f6b0fbab0010d7c93ed03a01e103ed))
* use a simple select for flat queries ([#324](https://github.com/cap-js/cds-dbs/issues/324)) ([a788a77](https://github.com/cap-js/cds-dbs/commit/a788a77dcb6c6625659ed2d74ee6a3b517e62e23))
* use place holders for update and delete ([#323](https://github.com/cap-js/cds-dbs/issues/323)) ([81472b9](https://github.com/cap-js/cds-dbs/commit/81472b971183f701e401247611310be56745a87a))


### Fixed

* A test fix to test release please ([#274](https://github.com/cap-js/cds-dbs/issues/274)) ([a444f78](https://github.com/cap-js/cds-dbs/commit/a444f7850eb41e844f5f9a2247ac5827c0fa6f7a))
* apply schema to hdb connection ([#348](https://github.com/cap-js/cds-dbs/issues/348)) ([439f845](https://github.com/cap-js/cds-dbs/commit/439f845aa3b27be7bcd33c900562401d8a1fbe12))
* large amounts of expands in HANA Service ([#355](https://github.com/cap-js/cds-dbs/issues/355)) ([7d8521a](https://github.com/cap-js/cds-dbs/commit/7d8521af8ca6e01d9a521272d0409bce52d1ce7c))
* localization on hana ([#354](https://github.com/cap-js/cds-dbs/issues/354)) ([6aedb7d](https://github.com/cap-js/cds-dbs/commit/6aedb7d6bd377c156fb9a9ceeb501d70812c6194))
* preserve $count for result of SELECT queries ([#280](https://github.com/cap-js/cds-dbs/issues/280)) ([23bef24](https://github.com/cap-js/cds-dbs/commit/23bef245e62952a57ed82afcfd238c0b294b2e9e))


### Performance Improvements

* HANA parallel expand ([#342](https://github.com/cap-js/cds-dbs/issues/342)) ([ff758ae](https://github.com/cap-js/cds-dbs/commit/ff758ae69f6e16d95a9b7cc0e9cee0722acaa51a))
* optimize session variables in HANA ([#339](https://github.com/cap-js/cds-dbs/issues/339)) ([4240c58](https://github.com/cap-js/cds-dbs/commit/4240c582af24289af59cdaa7fe073ab92f07fdf4))

## Change Log

- All notable changes to this project are documented in this file.
- The format is based on [Keep a Changelog](http://keepachangelog.com/).
- This project adheres to [Semantic Versioning](http://semver.org/).

## Version 1.0.0 - tbd

- Initial release
