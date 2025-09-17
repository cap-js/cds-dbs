[![REUSE status](https://api.reuse.software/badge/github.com/cap-js/cds-dbs)](https://api.reuse.software/info/github.com/cap-js/cds-dbs)

# Welcome to the @cap-js/cds-dbs Monorepo

This is a monorepo for our SQL Database Services.

It contains subfolders for the [base database service implementation](./db-service/) as well as the implementation of this interface for [SQLite](./sqlite/), [PostgreSQL](./postgres/) and [SAP HANA](./hana/).
Each of the subfolders is published as individual npm module.

Documentation can be found at [cap.cloud.sap](https://cap.cloud.sap/docs/guides/databases).

## Prerequisites

See [Getting Started](https://cap.cloud.sap/docs/get-started/in-a-nutshell) on how to jumpstart your development and grow as you go with [SAP Cloud Application Programming Model](https://cap.cloud.sap).

## Setup

In general, all you need to do is to install one of the database packages, as follows:

Using SQLite for development:

```sh
npm add @cap-js/sqlite -D
```

Learn more about setup and usage in the [respective database guides](https://cap.cloud.sap/docs/guides/databases).

## Support

This project is open to feature requests/suggestions, bug reports etc. via [GitHub issues](https://github.com/cap-js/cds-dbs/issues).

## Contribution

Contribution and feedback are encouraged and always welcome. For more information about how to contribute, the project structure, as well as additional contribution information, see our [Contribution Guidelines](CONTRIBUTING.md).

## Code of Conduct

We as members, contributors, and leaders pledge to make participation in our community a harassment-free experience for everyone. By participating in this project, you agree to abide by its [Code of Conduct](CODE_OF_CONDUCT.md) at all times.

## Licensing

Copyright 2024 SAP SE or an SAP affiliate company and cds-dbs contributors. Please see our [LICENSE](LICENSE) for copyright and license information. Detailed information including third-party components and their licensing/copyright information is available [via the REUSE tool](https://api.reuse.software/info/github.com/cap-js/cds-dbs).
