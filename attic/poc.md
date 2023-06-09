# cds-sqlite

SQLite database layer for cds

## Proof of Concept

This repository is currently being used to create the Proof of Concept for a new approach for pluggable Database layers.


## Concepts

Here we can list some of the concepts that we would like to include inside the new pluggable Database layer architecture.

### Separate Application from Database

At the core of the pluggable Database layer concept it is required to have a hard cut between the application layer and the database layer. For this clear separation it is required to define an API that has to be fulfilled by the Database layer so the Application layer can function with ignorance of the contents of the Database layer.

#### Database Isolation

For Cloud applications there are a few important levels of isolation required for secure and proper function. These levels of isolation should be transparent for the Database layer for simplicity and flexibility. By exposing the required APIs from the Database layer it empowers the Application layer to manage the required levels of Database isolation.

An important pilar of the CAP story is to start small and scale over time. By giving the isolation control to the Application layer it is possible for the Database layer to simply assume it is running in a single context as new contexts will be created by the Application layer when required. Ensuring that the development of the Database layer will always be on the lowest level of complexity as possible (e.g. single connection).

#### Compliance

To enable the Application layer to function as expected it is required to ensure Database layer compliance. When a bug is reported for `@sap/cds` it must be possible to reproduce this bug no matter the Database layer used. To greatly reduce the time required to identify root causes it must be possible to exclude the possibly infinite list of Database layers.

As the SAP strategy is `HANA` / `HANA cloud` it should be considered the gold standard of Database layer behavior. When a `cqn` is send to a Database layer no matter what it should respond in the exact same manor as `HANA` its Database layer does. Taking this approach does come with a long list of requirements.

With the long list of requirements it creates a new argument for Database layers to not be fully compliant with the `HANA` Database layer (probably `HANA` and `HANA cloud` won't be compliant with each other). Therefor converting the definition of "Database support" from a hard "yes" or "no" to a gradient of compliance. We might have a long list of supported Database layers, but most of them with a <50% compliance rating.

This basically allows for a reduction of supported functionalities (within reason).

##### CSN / CQN

Should be pretty clear that `CSN` and `CQN` should be on a functional level be clear candidates for communicating queries and models to the Database layer.

##### Clarity

By providing an extensive automated test suite it is possible to clearly define what is expected of a Database layer to be supported. Through adding error testing it enables reducing the scope of what functionalities should be implemented. While `CSN` and `CQN` are very strong at modeling any type of query. This also means that it can model queries that should not be supported. By including tests that specifically expect the Database layer to fail in a certain way clarifies what scenarios to not focus on.

For example it is possible to define an `INSERT` `CQN` that targets an entity which is based upon a `SELECT` that contains a `join`. With the current `cds` implementation the request will be rejected as an invalid request. While with the PoC for `sqlite2` it has been shown that there is no check before the Database layer whether this `INSERT` is valid or not. As long as the Database layer implements the `table` look up and extracts the correlation information from the `join` it is possible to expand the `CQN` into multiple `INSERT` statements and update all root tables are required to created the correct `data` in the joined view.

Joined entity definition:

```cds
entity Combine as
  select from my.Books
  left join my.Authors
    on Books.author.ID = Authors.ID
  {
    Authors.name,
    Authors.ID as author_ID,
    Books.ID,
    Books.descr
  };
```

HTTP request definition:

```http
POST {{server}}/admin/Combine
Content-Type: application/json;IEEE754Compatible=true
Authorization: Basic alice:

{
  "ID": 2,
  "author_ID": 103,
  "name": "Arthur",
  "descr": "Booky"
}
```

SQLite2 based response

```http
HTTP/1.1 201 Created
X-Powered-By: Express
x-correlation-id: 47128456-25e9-4092-a5a5-681de1400732
OData-Version: 4.0
content-type: application/json;odata.metadata=minimal
Location: Combine(undefined)
Connection: close
Content-Length: 101

{
  "@odata.context": "$metadata#Combine/$entity",
  "name": "Arthur",
  "author_ID": 103,
  "ID": 2,
  "descr": "Booky"
}
```

##### Matrix

The results of the compliance testing suite should be automatically converted into an overview matrix / table. As this will create easy access to critical information needed to developers using CAP. Allowing them to make decision on whether to start using a Database layer or not. Whether the bug they are facing is possibly coming from the Database layer rather then the `@sap/cds` Application layer. If it is know that a certain Database layer is not compliant in the manor of sorting. The developer can easily find out that the root cause of the wrong response is the Database layer rather then the core logic in `@sap/cds`.

Having clearly state which is supported by what is very common in the JavaScript ecosystem. The most common two are probably browser compatibility with the HTML standard from [Mozilla](https://github.com/mdn/browser-compat-data) and [ecmascript](https://kangax.github.io/compat-table/es2016plus/) itself with browser, compilers, Servers and mobile platforms.

Of which both examples show that having 100% compliance for the specification is rare and most likely not a necesity. The most important aspect is to create transparency on what works and what does not work (yet).

##### Functions

`HANA` comes with a few very useful and a few not very useful functions. Currently the only way to define a model that contains `HANA` functions is by running on top of a `HANA` system. While it might be possible for other Database to provide the exact same (or approximated) functionalities. There currently is no mechanism which allows for these kind of enhancements on the Database layer to be implemented. By including the 240 publicly documented `HANA` [functions](https://help.sap.com/docs/SAP_HANA_PLATFORM/4fe29514fd584807ac9f2a04f6754767/f12b86a6284c4aeeb449e57eb5dd3ebd.html) to the compliance set it becomes clear how much of a difference there truly is in behavior between a Database layer and the native HANA Database layer.

As mentioned before it is not necessary to have full compliance with the `HANA` Database layer, but by adding clarity it allows developers to know what they can use and what they cannot use. Also when doing it properly it will be clear how to contribute a missing function to a Database layer. Increasing the chance of converting a CAP consuming developer into a CAP contributing developer. Especially as quite a few of these functions can be one liners and an easy stepping stone into the contributor life. As these functions are anyway covered by the test suite the maintainer of the Database layer repository does not need to worry whether the implementation is correct as the tests will show this automatically. Making this whole flow a possible easy win for everyone involved.

- One less feature request / bug for CAP
- One more developer contributing to CAP
- No additional overhead for the Database maintainer

### logging

how, what ?

### Delta deploy

Currently the deployment is done through the `deploy` function. Which receives a `CSN` definition for the model to deploy. This could instead be done through the `run` function using `CQN`. Currently the `CQN` definition provides interfaces for `CREATE` and `DROP`, but is lacking an `ALTER` definition. Which would be required to upgrade definitions without losing all data.

So by taking two model definitions and comparing them it would be possible to create a list of `CQN` statements that the Database layer has to execute to achieve the new model state. This comes with a few challenges:

- Getting the current state of the database as a model
- Finding renames instead of removing and creating a new column / table

#### Current Model

The main approach that is taken for `SQL` databases to know the current state of the Database is to look at `SYS` tables. Retrieving all the currently known definitions on the Database and comparing it with the future expected state. This is very `SQL` specific and this might not even exist on some Databases.

Therefor it might be good to have a look at what `HDI` is doing. Their `API` is completely file based. They expose procedures that can be called to upload files to their container tables. These files can also be downloaded. When a deployment is triggered `HDI` compares the current state files with the future state files and constructs the delta statements from these comparisons. So very straight forward approach would be to store the `CSN` definition into the Database and expose a way to extract the `CSN` definition from the Database. Allowing the application layer to compare its `CSN` from disk with the `CSN` on the Database. Creating a delta and its corresponding `CQN` statements to alter the structure to match the expected structure.

#### Renaming columns / tables

When looking at `HDI` once more as example. It shows as the biggest weakness of the platform that it is not possible to rename columns as it is doing file comparisons without any additional information. There might be some information that could be gained from `git` history as it also is possible to find renamed files, but this probably comes with fall positives where there just happened to be a new column added that has the same data type. So there most likely is not easy solution to solving the renaming problem. Without additional historical information being provided from the developers.

Deploy through `CQN`
