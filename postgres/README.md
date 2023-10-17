# CDS database service for Postgres

Welcome to the new Postgres database service for [SAP Cloud Application Programming Model](https://cap.cloud.sap) Node.js, based on new, streamlined database architecture and [*pg* driver](https://www.npmjs.com/package/pg) .

## Setup

In general, all you need to do is to install one of the database packages, as follows:

```sh
npm add @cap-js/postgres
```

Learn more about setup and usage in the [respective database guide](https://cap.cloud.sap/docs/guides/databases-postgres).

## Support

This project is open to feature requests/suggestions, bug reports etc. via [GitHub issues](https://github.com/cap-js/cds-dbs/issues).

## Contribution

Contribution and feedback are encouraged and always welcome. For more information about how to contribute, the project structure, as well as additional contribution information, see our [Contribution Guidelines](CONTRIBUTING.md).

## Versioning

This library follows [Semantic Versioning](https://semver.org/).
All notable changes are documented in [CHANGELOG.md](CHANGELOG.md).

## Code of Conduct

We as members, contributors, and leaders pledge to make participation in our community a harassment-free experience for everyone. By participating in this project, you agree to abide by its [Code of Conduct](CODE_OF_CONDUCT.md) at all times.

## Licensing

Copyright 2023 SAP SE or an SAP affiliate company and cds-dbs contributors. Please see our [LICENSE](LICENSE) for copyright and license information. Detailed information including third-party components and their licensing/copyright information is available [via the REUSE tool](https://api.reuse.software/info/github.com/cap-js/cds-dbs).

## migration guide from `cds-pg` to `@cap-js/postgres`

`@cap-js/postgres` works as a drop-in replacement for `cds-pg`.  
However, some preliminary checks and cleanups help:

- for using the BTP Postgres Hyperscaler as database, 
  - know that the credentials are picked up automatically by from the enviornment (`VCAP_SERVICES.postgres`)
  - the service binding label is `postgresql-db`
  - `cds-dbm` is replaced by a hand-crafted "db-deployer" app &rarr; see below
- your local `package.json`: you can safely remove the entry `cds.requires.postgres` previously mandatory for `cds-pg`
- recommendation: set the env var `DEBUG=sql` during local development to see DB-level output from PostgreSQL

### schema migration

`@cap-js/postgres` brings the same schema evolution capabilities to PostgreSQL known from HANA and SQLite.  
Enabling schema migration in an existing `cds-pg`-based project consists of generating and deploying a "csn-snapshot" of your database structure.

#### local development

First, set a basis for the evolution
`$> cds deploy --model-only`  
&rarr; this will create the table `cds_model` laying the foundation for the schema migration

Subsequent deployments can then re-use the standard deploy mechanism via `$> cds deploy`

#### On BTP, Cloud Foundry environment

The above "csn-snapshots" can be implemented via the `mtar`-based approach. At the same time, the same `mtar` can be used for subsequent PostgreSQL deployments (with schema evolution).

Two major steps in addition to enabling the schema evolution are included in this `mtar`.

1. create local folder `deployer` (any name works)
2. in `deployer`, create a `package.json` containing

  ```json
  ...
  "//npm run migrate": "only one-time!",
  "migrate": "cds deploy --model-only",
  "//npm run deploy": "subsequent deployments",
  "deploy": "cds deploy"
  ...
  ```

3. add a section to your `/mta.yaml` denoting the `deployer` directory as a standalone application that runs one-time

```yaml
- name: pg-db-deployer
    type: custom
    path: deployer
    parameters:
      buildpacks: nodejs_buildpack
      no-route: true
      no-start: true
      disk-quota: 2GB
      memory: 512MB
      tasks:
      - name: migrate
        command: npm run migrate
      # # for subsequent deployments
      # - name: deploy
      #  command: npm run deploy
        disk-quota: 2GB
        memory: 512MB
    build-parameters:
      before-all:
        custom: 
        - npm i
        # generate the "csn-snapshot" - only necessary for one-time migration,
        # can be commented out on subsequent deployments
        - cds compile '*' -2 json > deployer/schema.csn
      ignore: ["node_modules/"]
    requires:
      - name: pg-database

resources:
  - name: pg-database
    parameters:
      path: ./pg-options.json
      service: postgresql-db
      service-plan: trial # change to yours!
      skip-service-updates:
        parameters: true
      service-tags:
        - plain
    type: org.cloudfoundry.managed-service
```

## migration points to consider

### mixed-case identifiers

even though column names that are not double-quoted are folded to lowercase in PostgreSQL (`yourName` -> `yourname`, `"yourName"` -> `yourName`),  
you can use the mixed case definitions from your `.cds` files to reference them.  

example: `brewery_id` on DB level -> `brewery_ID` on CDS level

formerly w/ `cds-pg` you had to follow the DB level: `SELECT.from(Beers).columns('brewery_id').groupBy('brewery_id')`  
now, re-use the CDS definitions: `SELECT.from(Beers).columns('brewery_ID').groupBy('brewery_ID')`

So please adjust your `CQL` statements accordingly.

### timezones (potential _**BREAKING CHANGE**_)

any date- + time-type will get stored in [`UTC`](https://en.wikipedia.org/wiki/Coordinated_Universal_Time) **without any timezone identifier in the actual data field**.  
CAP's inbound- and outbound adapters take care of converting incoming and outgoing data from/to the desired time zones.  
So when a `dateime` comes in being in [an ISO 8601](https://en.wikipedia.org/wiki/ISO_8601) compatible format  
  `2009-01-01T15:00:00+01:00` (15:00:00 on January 1 2009 in Vienna (CEST))  
will get stored as  
  `2009-01-01T13:00:00` (13:00:00 on January 1 2009 in UTC).

Please be aware of that concept and rely on the client to parse UTC in your desired timezone (format).

### `cds.DatabaseService` consumption

`InsertResult` now does only return the affected rows and their `ID`s.

```js
const entries = [
  { name: 'Beer1', /* ... */ },
  { name: 'Beer2', /* ... */ },
  { name: 'Beer3', /* ... */ }
]
const insertResult = await cds.run(INSERT.into(Beers).entries(entries))
expect(insertResult.affectedRows).to.equal(3)
const beers = [...insertResult] //> this calls the [Symbol.iterator] method of the insert result
// beers:
// [ 
//   { ID: "f81d7ee5-922b-48a1-a12a-a899b8594c99" }, 
//   { ID: "ddda7f8e-e26b-430f-a80c-ac2c7df29510" },
//   { ID: "7228c40f-0046-4f53-8a2b-3d55ad825f59" }
// ]
```

In `cds-pg`, we additionally surfaced the entire inserted dataset.

```js
// continuing after the insert of the above example:
// const insertResult = await cds.run(INSERT.into(Beers).entries(entries))

// this works NO MORE - see above
const beers = insertResult.results
expect(beers.length).toStrictEqual(3)
expect(beers[0].ID).toMatch(uuidRegex)
expect(beers[0].createdAt.toISOString()).toMatch(timestampRegex)
expect(beers[0].modifiedAt.toISOString()).toMatch(timestampRegex)
```

So please adjust your runtime coding accordingly.
