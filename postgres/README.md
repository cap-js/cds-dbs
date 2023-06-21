# PostgreSQL Adapter for SAP CAP

## install + config

### Cloud Foundry - User Provided Service

If you use a [user-provided service](https://cli.cloudfoundry.org/en-US/v8/create-user-provided-service.html)
in Cloud Foundry to connect to your PostgreSQL Database, make sure to add the tag `postgresql-db` to your service
instance.

To create a service instance `my-pg-db` use the command:

```
cf create-user-provided-service my-pg-db -p /path/to/credentials.json -t "postgresql-db"
```

## migration guide

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