# CDS database service for SAP HANA

Welcome to the SAP HANA database service for [SAP Cloud Application Programming Model](https://cap.cloud.sap) Node.js, based on streamlined database architecture.

## Setup

All you need to do is to install the database package, as follows:

```sh
npm add @cap-js/hana
```

Learn more about setup and usage in the [respective database guide](https://cap.cloud.sap/docs/guides/databases/hana).

## Fuzzy search similarity calculation mode

Fuzzy search uses the HANA similarity calculation mode `search` by default.
Set `cds.hana.similarityCalculationMode` in your application's `package.json` to
choose another mode, for example:

```json
{
  "cds": {
    "hana": {
      "similarityCalculationMode": "substring search"
    }
  }
}
```

The supported values are `compare`, `type ahead`, `search compare`, `search`,
`symmetric search`, `substring search`, and `flexible`, as documented in the
[SAP HANA Cloud SCORE reference](https://help.sap.com/docs/hana-cloud-database/sap-hana-cloud-sap-hana-database-sql-reference-guide/score-function-miscellaneous-20e6f8e97519101489a0cd3c29991e72).
Invalid values cause an error when rendering fuzzy-search SQL.

The setting applies to all fuzzy-search columns, including columns annotated with
`@Search.ranking` or `@Search.fuzzinessThreshold`, and to relevance ordering.
It does not change the fuzziness threshold. When `cds.hana.fuzzy` is `false`, the
existing case-insensitive `LIKE` search is used and this setting is ignored.

## Support

This project is open to feature requests/suggestions, bug reports etc. via [GitHub issues](https://github.com/cap-js/cds-dbs/issues).

## Contribution

Contribution and feedback are encouraged and always welcome. For more information about how to contribute, the project structure, as well as additional contribution information, see our [Contribution Guidelines](../CONTRIBUTING.md).

## Code of Conduct

We as members, contributors, and leaders pledge to make participation in our community a harassment-free experience for everyone. By participating in this project, you agree to abide by its [Code of Conduct](../CODE_OF_CONDUCT.md) at all times.

## Licensing

Copyright 2024 SAP SE or an SAP affiliate company and cds-dbs contributors. Please see our [LICENSE](LICENSE) for copyright and license information. Detailed information including third-party components and their licensing/copyright information is available [via the REUSE tool](https://api.reuse.software/info/github.com/cap-js/cds-dbs).
