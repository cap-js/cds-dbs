# Change Log

- All notable changes to this project are documented in this file.
- The format is based on [Keep a Changelog](https://keepachangelog.com/).
- This project adheres to [Semantic Versioning](https://semver.org/).

## Version 9.0.1 - tbd

### Added

### Changed

### Fixed

### Removed

## Version 9.0.0 - 2025-05-07

### Added

- CAP-native task queues (beta; replacing generic outbox -- see section Changed for additional details)
  + Events and requests to a "queued service" are written to the database in the current transaction (with default kind `persistent-queue`) and processed as asynchronous tasks
    + Statically queue a service via config `cds.requires.<srv>.queued = true`
    + Programatically queue or unqueue a service via `cds.queued(srv)`/ `cds.unqueued(srv)`
    + Disable the persistent task queue via `cds.requires.queue = false`
  + Tasks are processed in dedicated transactions (except on SQLite, where there are no concurrent transactions)
  + Tasks are retried until processed succesfully or the max. retry count is reached, i.e., adding resiliency to the respective service
    + Tasks that cause unrecoverable or programming errors will remain in the database table but will not be retried
  + Experimental task scheduling API `<srv>.schedule()` as variant of `<srv>.send()` with fluent API options `.after(<ms>)` and `.every(<ms>)`
  + Experimental task callback API `<srv>.after('<event>/#succeeded', (results, req))`/ `<srv>.after('<event>/#failed', (error, req))`
  + Experimental task trigger API `<srv>.flush()`
- Inbox: Inbound messages can be accepted as asynchronous tasks via config `cds.requires.messaging.inboxed = true`
- Not null validiations for actions and functions
- `cds.auth`: Provide custom configuration to `@sap/xssec`-based authentication via `cds.requires.auth.config`
- IAS: Token validation for requests to the app's "cert url" (with `.cert` segment in the domain)
- Support refs with longer path expressions like `ref: ['root', 'child', 'subchild', 'ID']` when resolving queries to the target entity

### Changed

- Evolution of the generic outbox to CAP-native task queues:
  + `cds.queued()`/ `cds.unqueued()` replace `cds.outboxed()`/ `cds.unboxed()` (temporary compat in place)
  + Global configuration `cds.requires.queue` replaces `cds.requires.outbox` (temporary compat in place)
  + New default `cds.requires.queue = true`. This change requires a database deployment (for table `cds.outbox.Messages`) if `cds.requires.outbox` was not manually set to `true` before.
  + Default `chunkSize` reduced from `100` to `10`. If parallel processing is disabled (`parallel = false`), the `chunkSize` config is ignored and the effective `chunkSize` is `1`.
- Support for `@sap/cds-mtxs` version 1 is dropped
- Service level restrictions for application service calls are enforced by default
  + Opt out with `cds.features.service_level_restrictions=false` until next major version
- `req.diff` uses a deep expand to fetch data for deep update comparison. Previously, it read each composition layer sequentially.
- `cds.test` now requires module `@cap-js/cds-test` to be installed. Test dependencies like `axios`, `chai`, `chai-as-promised`, and `chai-subset` can be usually removed in favor of `@cap-js/cds-test`.
- `cds.context.locale` is only set if initiated from an HTTP client specifying a locale
- Only new major version 4 of SAP Cloud SDK is supported from now on . Please make sure to upgrade. Detailed changes are documented in the [migration guide](https://github.com/SAP/cloud-sdk-js/blob/main/V4-Upgrade-Guide.md).
- `cds-serve` now fails if `@sap/cds` would be loaded from different installation paths to prevent inconsistent server state. Such situations are always a setup issue, often caused by plugins that require diverging versions. Disable with `cds.server.exit_on_multi_install: false`.
- For drafts, read-only fields must be set in `CREATE` handlers (calculated values set in `NEW` handlers are cleansed). If children are added in draft `CREATE` handlers, the field `DraftAdministrativeData_DraftUUID` must be set.
- `hdbtabledata` files created by `cds compile/build` now instruct SAP HANA to decode base64 values in CSV files for `LargeBinary` elements. This aligns the behavior with SQLite and H2, avoiding manual base64 decoding. It can be disabled with `cds.hana.table_data.column_mapping.LargeBinary=false`.
- `PATCH` requests no longer create the target resource if it doesn't exist (`UPSERT` semantics)
  + Re-enable via flag `cds.runtime.patch_as_upsert=true`
- `PUT` requests no longer set unprovided properties to their default values (`REPLACE` semantics)
  + Re-enable via flag `cds.runtime.put_as_replace=true`
  + If enabled, the defaulting is now done in the protocol adapter
- `req.params` is an array of objects (instead of plain values for single-keyed entities with key `ID`)
  + Opt out with `cds.features.consistent_params=false` until next major version

### Fixed

- Webhook creation in `enterprise-messaging` is more resilient in case of multiple instances
- `cdsjsonschema` protocol in lower case for cds json schema
- In `CREATE` handlers for drafts, the original path is preserved
- `@sap/cds-mtxs` is now loaded before other plugins so that they can register handlers for mtx services.
- The default index page respects now `cds.odata.containment`
- Remove incorrect `Type` suffix from `@odata.context` for views with parameters
- Support where clauses in refs

### Removed

- Legacy OData adapter which was enabled with compat `cds.features.odata_new_adapter=false`
- Legacy Database services which were enabled with `@sap/cds-hana` or `sqlite3`
- `@cds.default.order` and `@odata.default.order` for implicit sorting
- `cds.auth`: Support for `@sap/xssec^3` (incl. compatibility mode of `@sap/xssec^4`)
- Undocumented compat flag `cds.features.odata_v2_result_conversion`
- Undocumented util `cds.utils.pool`
- Undocumented method `INSERT.as`. Use `INSERT.from` instead to insert sub `SELECT` queries.
- Undocumented method `req._queryOptions` of `cds.Request` belonging to the new OData adapter
- Undocumented method `_reset` of the `cds.ql` API
- Undocumented property `cmd` of the `cds.ql` `Query` class. Please use method `kind` instead.
- Undocumented method `protocol4` of the `Protocol` class. Please use property `def.protocols` instead.
- Undocumented methods `impl` and `with` of the `ApplicationService` class. Please use `prepend` instead.
- Undocumented compat flag `cds.features.rest_error_handler`
- Deprecated compat flags `cds.features.compat_restrict_bound` and `cds.env.features.compat_restrict_where`
- Deprecated compat flag `cds.features.stream_compat`
- Deprecated feature flag `cds.log.kibana_custom_fields`. Please use `cds.log.als_custom_fields` instead`.
- Deprecated compat flag `cds.features.keys_in_data_compat`
- Deprecated element-level annotation `@Search.defaultSearchElement`. Please use annotation `@cds.search` instead.
- Deprecated stripping of unnecessary topic prefix `topic:` in messaging
- Deprecated messaging `Outbox` class. Please use config or `cds.outboxed(srv)` to outbox your service.
- Unused property `partition` from entity `cds.outbox.Messages`

## Version 8.9.3 - 2025-05-06

### Fixed

- OData: `$value` access of primitive properties returned by custom handler
- UCL: Add missing declaration of variable `$input` in mutation for creating an application template
- Purge of `servers` from `.cds-services.json` file
- Loading of relative service implementations in plugins
- `cds.compile.to.edmx` in case the model was manipulated in a plugin

## Version 8.9.2 - 2025-04-14

### Fixed

- `forUpdate` will not consider `wait` if `ignoreLocked` is set
- Do not crash in case of custom `DraftAdministrativeData` table

## Version 8.9.1 - 2025-04-03

### Fixed

- `cds.env` merging for `null` values
- Best-effort mechanisms for lambda support on OData V2 remote services (usage of functions in lambda expressions)
- Use extended model in `enterprise-messaging` inbound handlers
- Compat flag `cds.features.draft_compat` for handler registration in draft scenarios

## Version 8.9.0 - 2025-03-31

### Added

- Support for parallel multi-instance processing of outbox entries
- Remote services: ensure request correlation by guaranteeing outgoing header `x-correlation-id`
- Support for `@odata.bind` to reference foreign keys
- Support for plugins in ESM format
- Dependency to `@eslint/js` so that `eslint` works w/o the application having to install it.
- IAS: In the `client_credentials` flow, the array of `ias_apis` (if present) is added to the technical user's roles
- Opt-in feature `cds.features.consistent_params` for `req.params` always being an array of objects
  + That is, no more plain values for single-keyed entities with key `ID`
  + Will become the default in `@sap/cds^9`

### Changed

- Invalid draft requests now have status code 400
- Allow ESM loading of handler files (`.js`, `.ts`) in all situations, incl. test runs with Jest's `--experimental-vm-modules` option.
- Application and remote services now throw the error `Target <yourTarget> cannot be resolved for service <yourService>` when the query cannot be resolved to the service entity. Setting the feature flag `cds.env.features.restrict_service_scope` to false disables this.
- Accept 2xx status codes set in custom operation handlers
- Implicit orderby elements are marked as such and are no longer considered for requests to remote services

### Fixed

- Lean draft: Proper navigation to the service entity of draft-administrative data
- Unprocessed foreign keys from expressions of semi join conditions in `UPDATE.data`
- Kafka: Each topic will have a dedicated consumer-group id (configurable with `consumerGroup`)
- Foreign-key calculation based on navigation path
- `cds.env` shortcuts like `cds.requires.db === 'hana'` are normalized to `cds.requires.db.kind === 'hana'` when combined from multiple sources
- Error handling for invalid access of an entity that does not have a key, by key, through REST
- `cds.validate` crashed with unknown target
- `cds.parse.expr` parsed SAP HANA native functions like `current_utctimestamp` erroneously as `ref`
- `null` values in logger if `custom_fields` are configured
- User-provided instances of SAP Cloud Logging should have either tag `cloud-logging` or `Cloud Logging`
- The `@odata.context` for entities and views with parameters should refer to the EntityType with `/Set` at the end e.g. `../$metadata#ViewWithParamType(1)/Set`

## Version 8.8.3 - 2025-03-20

### Fixed

- Event Mesh: Reconnect in case of error in AMQP connection

## Version 8.8.2 - 2025-03-13

### Fixed

- Consuming REST actions returning anonymous structures
- `i18n.labels/messages` were occasionally missing

## Version 8.8.1 - 2025-03-07

### Fixed

- Requests violating `cds.odata.max_batch_header_size` are terminated with `431 Request Header Fields Too Large` instead of `400 - Bad Request`
- `cds.parse.<x>` writing directly to `stdout`
- Instance-based authorization for programmatic action invocations
- Implicit function parameter calls with Array or Object values
- OData: Throw an error by `POST` with payload that contains array of entity representation
- `cds.validate` filters out annotations according to OData V4 spec
- Crash for requests with invalid time data format
- Add missing 'and' between conditions in object notation of QL
- Multiline payloads in `$batch` sub requests
- Instance-based authorization for modeling like `$user.<property> is null`
- Respect `cds.odata.contextAbsoluteUrl` in new OData adapter
- `cds.odata.context_with_columns` also applies to singletons

## Version 8.8.0 - 2025-03-03

### Added

- `cds.ql` method `SELECT.hints()` which passes hints to the database query optimizer that can influence the execution plan
- Schema updates for MTX configuration
- Deprecate `cds.requires.db.database` in JSON schema
- Service level restrictions for application service calls can be enforced with `cds.features.service_level_restrictions=true`
  + With `@sap/cds^9`, this becomes the new default.
- Support implicit function parameters calls with @prefix
- `cds.test` now uses package `@cap-js/cds-test` if installed, otherwise prints a hint to install it. With cds 9, this package will be required.
- Operation response streaming
  + OData: Operations returning `cds.LargeBinary` annotated with `@Core.MediaType` may send stream responses.
  + REST: Operations may send stream responses.
  + Annotations `@Core.MediaType`, `@Core.ContentDisposition.Filename` and `@Core.ContentDisposition.Type` on operation return types will be considered.

### Changed

- The default index page now shows links to CDS functions with their parameter names but no default values anymore.

### Fixed

- Order by virtual fields in draft-related requests
- Erroneous cleansing when draft activation is invoked programmatically
- Skip validation for mandatory fields in update scenarios for entities in draft activation
- Simplified default configuration: `cds.requires.messaging = true`
- `cds.connect` called with options erroneously filled in `cds.services`
- Mocked users won't have a tenant in single-tenant mode
- Allow usage of latest versions of `chai` and `chai-as-promised` on Node >= 23 with the built-in test runner and `mocha`. The `jest` runner is not able though to load these ESM modules.
- Reject navigations in expand
- Activation of drafts for entities using `@cds.api.ignore`
- Prevent uncaught type error during validation of composition entries

## Version 8.7.2 - 2025-02-14

### Fixed

- Strip `Z` suffix of values of `cds.Timestamp` with OData type `Edm.DateTime`
- Skip validation for mandatory fields in update scenarios for entities in draft activation
- `cds.compile.to.yaml` escapes strings including colons if necessary

## Version 8.7.1 - 2025-02-04

### Fixed

- Loading of CAP Plugins implemented in Typescript
- `Location` header if read after write returns empty result due to missing read authentication
- Enable accessing `req.params` when handling requests on parameterized views
- `cds.connect.to(class {...})` did not call the `init` function
- Generic Paging/Sorting was run twice for non-draft requests
- Service implementation loaded from `node_modules`

## Version 8.7.0 - 2025-01-28

### Added

- Allow usage of tar library (https://www.npmjs.com/package/tar) as a workaround to solve remaining issues by extension build on Windows. The tar library should be installed by app developers.
- `cds.ql` supports limit with an optional offset, e.g. `limit(10, 5)`
- Basic support for new built-in type `cds.Map`
- Normalization of DateTime and Timestamp payloads in new OData adapter

### Changed

- Cleanse immutable values in draft modifications
- Do not use compatibility mode of @sap/xssec 4, can be reverted with `cds.env.features.xssec_compat = true`
- `cds.Float` is now correctly deprecated in `cds.builtin.types`.
- Input provided via protocol adapter for elements annotated with `@cds.api.ignore` are rejected. Previously, they were ignored.

### Fixed

- Narrowed down peer dependency version of `express` to `^4`
- OData, REST: Responses are only written in case that the response object is not already closed, which allows responding to requests directly in custom handlers.
  + Note: Responses sent directly are not transactionally safe! Further, subsequent errors can no longer be communicated to the client!
  + Note: Only respond directly in non-`$batch` requests!

## Version 8.6.2 - 2025-01-27

### Fixed

- Crash during requests to actions with parameter `array of <type>`
- Instance based restriction using `is null`
- Filtering of grouped result on default aggregate
- Multipart batch response for failed changesets
- Handling of invalid parentheses in OData property access
- Resolve view: Mixins are not in elements of projection target
- Input provided via protocol adapter for elements annotated with `@cds.api.ignore` can be rejected with `cds.features.reject_ignored: true`.

## Version 8.6.1 - 2025-01-10

### Fixed

- find draft root in authorization checks when entity has recursive compositions
- `default-env.json` was not loaded anymore when in production mode.
- i18n texts like `1` or `true` were returned as numbers, or booleans instead of strings
- CSN files produced by `cds build` now again contain information to resolve handler files. That was broken in case of reflected/linked models set by e.g. plugins.
- `average` aggregation used with draft enabled entities

## Version 8.6.0 - 2024-12-17

### Added

- `SELECT.from` now supports full-query tagged template literals, e.g.: ``` SELECT.from`Books where ID=${201}` ```
- `cds.ql` enhanced by functions to facilitate construction of CQN objects.
- `cds.ql` became a function to turn CQN objects, CQL strings, or tagged template literals into instances of the respective `cds.ql` class.
- New `cds` events to allow multitenant plugins: `compile.for.runtime`, `compile.to.dbx`, `compile.to.edmx`.
- `cds.env` now supports `.cdsrc.js` and `.cdsrc.yaml` files, also in plugins.
- `cds.env` now supports profile-specific `.env` files, e.g. `.hybrid.env` or `.attic.env`.
- Experimental OData parsing for hierarchy requests (`descendants`, `ancestors`, `TopLevels`)
- The new OData adapter now supports `cds.odata.containment`. Contained entities can only be accessed via their parents and do not show up as EntitySets in $metadata and the service document.

### Changed

- `CDL`, `CQL`, and `CXL` globals are deprecated => use respective functions from `cds.ql` instead.
- `CREATE`, and `DROP` globals are deprecated => use respective functions from `cds.ql` instead.
- Zulu time zone information is stripped from `cds.DateTime` properties when querying Odata V2 remote services
- Processing of `@restrict.where` was aligned with CAP Java:
  + Instance-based authorization on app service calls does not consider custom `WHERE` clauses of `UPDATE`/`DELETE` queries
    + Until `@sap/cds^9`, this change can be deactivated via `cds.env.features.compat_restrict_where = true`
  + Simple static clauses (e.g., `$user.level > 5`) are no longer evaluated by the server but added to the respective SQL regardless. As a result, requests may receive a response of `2xx` with an empty body instead of a `403`.
    + Until `@sap/cds^9`, this change can be deactivated via `cds.env.features.compat_static_auth = true`
  + Read restrictions on the entity are no longer taken into consideration when evaluating restrictions on bound actions/ functions
    + Until `@sap/cds^9`, this change can be deactivated via `cds.env.features.compat_restrict_bound = true`

### Fixed

- ETag calculation if column was provided as Javascript Date
- Forwarding of `/$count` queries while mocking the external service
- Resolving of implicit function parameters (e.g `GET .../test.foo?x='bar'`)
- Arrayed elements are not part of response unless explicitly selected with `$select`
- In case of nonexistent user attributes (`$user.X`), only the subclause gets substituted with `false`
- `@odata.context` in new OData adapter:
  + Fixed crash for requests to actions/functions when `cds.env.odata.context_with_columns` is enabled
  + Aggregation functions with `$apply` are now returned when `cds.env.odata.context_with_columns` is enabled
  + `@odata.context` is now the first property in the response values of `concat` requests
  + Binary key values are now properly encoded and formatted
  + Fixed keys appearing as `(undefined)` for updates via navigation to-one
  + Fixed key value pairs being returned as `undefined=undefined` for property access of aspects
  + Backlinks no longer appear as keys for property access of aspects
  + Non-anonymous structured types are now prefixed with the service name
  + Structured types no longer end with `/$entity`

## Version 8.5.1 - 2024-12-06

### Fixed

- `cds deploy --dry --model-only` no longer tries to load a SQLite database
- Requests with HTTP methods other than `POST` to the `/$batch` endpoint are now rejected when using the new OData adapter

## Version 8.5.0 - 2024-11-25

### Added

- New `cds.i18n` module used consistently for both, UI labels and runtime messages.
- Enhanced `cds.validate` to support open intervals for: `@assert.range:[(0),(Infinity)]` -> `0 < x < ∞`
- `package.json` validation and suggestions for messaging services.
- `cds.log()`: Detect binding to SAP Cloud Logging via user provided service. The user provided service must have tag `cloud-logging`.
- Support for function parameters via query component (example: `GET /foo?bar=baz` instead of `GET /foo(bar='baz')`)
- Experimental support for programmatic draft actions `srv.new(MyEntity, data)`, `srv.cancel(MyEntity.drafts, keys)`, `srv.edit(MyEntity, data)` and `srv.save(MyEntity.drafts, keys)`

### Changed

- `cds-deploy` script has a non-zero exit code on deployment failure
- Properties of type `cds.Binary` in URLs as well as request payload are converted to `Buffer`s.
  Properties of type `cds.LargeBinary` in request payload are converted to `Readable`s.
  Previously, both were provided as Base64-encoded strings.
  This change can be deactivated via `cds.env.features.base64_binaries = true`, which is set by default for profile `attic`.

### Fixed

- `cds.validate` should not delete readonly keys from `req.data`
- `cds.validate` should not reject imported associations
- Readonly fields must not be set when creating draft entities
- Validation of mandatory properties caused streams to be rejected for new OData adapter
- `cds.log` with null parameters and JSON format
- `cds.compile.to.sql` proper replacement for sqlite session variables in java projects
- `cds.compile.to.serviceinfo` ignores only the `endpoints` property for unknown protocols
- `Preference-Applied` header is returned in OData adapter if requested
- No location header is returned on OData update requests if `minimal` preference is set
- Handling of invalid requests for views with parameters

## Version 8.4.2 - 2024-11-13

### Fixed

- `cds.compile.to.edmx` if using the new builtin type `cds.Map`

## Version 8.4.1 - 2024-11-07

### Fixed

- Validate request method for operations
- Correctly generate CQN for lambda expressions in new OData adapter
- `req.diff()` on old database with property transitions

## Version 8.4.0 - 2024-10-29

### Added

- Set the maximum allowed size of HTTP headers in bytes for `$batch` subrequests via flag `cds.env.odata.max_batch_header_size` (default: 64 KiB)
- New OData flag `cds.env.odata.context_with_columns` that adds selected and expanded columns to `@odata.context`. Default is `false`
- New experimental option `--workers` to `cds watch/run/serve` that allows running a `cds.server` cluster
  (process env variable `WORKERS` or `CDS_WORKERS` can be used alternatively)

### Changed

- Internal API `srv.endpoints` now always is an array of endpoint objects, an empty one if the service is not served to any protocol.
- Property `.cmd` of `cds.ql.Query` (and subclasses thereof) is deprecated → use `.kind` instead
- For remote service calls to OData v2 services, less conversions are performed on the returned data

### Fixed

- Commands like `cds deploy` now fail with a clear error message if called with an invalid value for `cds.features.assert_integrity` (like `true`)
- Authentication validation errors (e.g., expired token, wrong audience) are logged as warning
- Requests using `$apply` will always apply implicit sorting on best effort mechanism
- Properly handle empty content-type in new OData adapter
- Error/crash with `cds.features.odata_new_parser` for requests containing `$expand=*` and `$select`, which selects individual columns and star, e.g. `$select=ID,*`
- Referencing new entities in `$batch` with new OData adapter did not work properly when using non integer content IDs in multipart/mixed
- `cds.compile.to.serviceinfo` to ignore unknown protocols
- New OData adapter and `cds.spawn` did not crash on programming errors (for example TypeError)

## Version 8.3.1 - 2024-10-08

### Fixed

- Erroneous caching in `cds.validate`
- Precedence of request headers for `cds.context.id`
- For `quoted` names, overwrite `@cds.persistence.name` for drafts and localized views properly
- Do not use hana error code as http status code

## Version 8.3.0 - 2024-09-30

### Added

- `cds.deploy` can now also write its DDL statements to a separate log
- Symlinks are followed in `cds test`

### Changed

- Unknown protocols in `@protocol` annotations formerly prevented server starts; they are merely ignored now with a warning in the logs.
- Deprecated configuration flag `cds.env.features.keys_in_data_compat` because of incompatibility with data validation in new OData adapter.
- `@cds.api.ignore` doesn't suppress an association, the annotation is propagated to the (generated) foreign keys.
- Where clauses of restrictions for bound actions and functions defined by `@restrict` are now enforced and no longer ignored.
- `@cap-js/telemetry` is now loaded before other plugins to allow better instrumentation.

### Fixed

- When modifying active children of of draft-enabled entities directly (`bypass_draft`), the error message was misleading.
- Cleaning up drafts calls `CANCEL` handlers
- Allow to call `CANCEL` on draft entities programmatically
- Encoding of `@odata.nextLink` path
- Computed fields are ignored in projections
- Consider `id` in a `ref` step for mapping of service elements to their name on the db.
- Feature toggles with new OData adapter.
- Target entity was incorrectly calculated for some actions in new OData adapter.
- `req.diff()` does not manipulate existing queries anymore.
- New OData adapter: normalize on commit error in `/$batch`

### Removed

- Alpha support for SAP Event Broker-based messaging (kind `event-broker`). Use CDS plugin `@cap-js/event-broker` instead.

## Version 8.2.3 - 2024-09-20

### Changed

- All annotations in input data are skipped and removed from the input by `cds.validate()` - as we did in legacy OData adapter

### Fixed

- Unmanaged associations are excluded from `@mandatory` checks
- Properly reject direct requests to `DraftAdministrativeData`
- Virtual elements annotated with `@Core.MediaType`
- OData Requests targeting a specific instance and custom handler returns empty array
- `cds-serve` and `cds-deploy` now set `cds.cli` information

## Version 8.2.2 - 2024-09-13

### Fixed

- Erroneous caching in `cds.validate`
- Properly check `$filter` element types across navigations

## Version 8.2.1 - 2024-09-04

### Fixed

- Date validation of legacy OData protocol adapter
- Content-Length headers in multipart batch request body
- Streaming requests with virtual properties
- Bring back support for `x-correlationid`
- Validation of inlined elements
- multipart `$batch` parsing with _--_ as part of payload

## Version 8.2.0 - 2024-08-30

### Added

- Allow `cds.connect.to (SomeService)` where `SomeService` is a class
- Lean draft: support CDS orderBy in `list status: all`
- Support where not in as object in `cds.ql` expressions like: `where({ID:{not:{in:[...]}}})`
- Unbound CDS functions now show up in the server's index page along with an exemplary call signature
- `cds.log`'s JSON formatter:
  + Field `w3c_traceparent` is filled based on request header `traceparent` (cf. W3C Trace Context) for improved correlation
  + Custom fields `cds.env.log.cls_custom_fields` are filled if bound to an instance of SAP Cloud Logging
  + Default `cds.env.log.als_custom_fields` enhanced by `{ reason: 3 }` (project config takes precedence)
- Support for `cds.hana` types like `cds.hana.ST_POINT` in `cds.builtin`
- Internal `cds.debug()` API now always returns a logger instance, which allows switching on debugging subsequently, e.g. by the like of `cds.log('sql','debug')`
- New config flag `cds.server.shutdown_on_uncaught_errors` allows to control whether the server should shut down on uncaught errors. Default is `true`

### Changed

- Revert workaround from 8.1.0 for server startup message `WARNING: Package '@sap/cds' was loaded from different installations`. This is now addressed in `@sap/cds-mtxs` 2.0.5.
- When parsing CSV files, `cds.deploy` no longer doubles a literal `\` character (backslash) with a second backslash (`\\`), but retains it as-is.  This caused unwanted data changes.
- Optimized handling of large binaries (BLOBs) in case of drafts. Unchanged BLOBs are not copied into the draft entity. If those BLOBs from draft entities are requested, the unchanged BLOBs will be fetched from the corresponding active entity. Note that this change may require adjustment of custom logic, if large binaries from draft entities are requested (for example, using `ql.SELECT` statement). To restore previous behavior use `cds.features.binary_draft_compat`.

### Fixed

- Resolving views with path expression renamings
- Set content-type-header in batch for actions with 204 No Content
- URI encoding of `@odata.nextLink` in OData response
- Requests reading media data streams did not provide `req.params`
- `cds.compile.to.hana` for legacy hana service with `@cap-js/sqlite` as dev dependency
- Better redaction of debug output
- Instance-based authorization using functions
- Fixed flaws in `cds.connect.to()` that lead to deadlocks in case of errors due to invalid service configurations or initializations.
- Navigation with backlink as key can now omit backlink keys for new OData adapter

### Removed

- Array methods `forEach`, `filter`, `find`, `map`, `some`, `every` from [`LinkedDefinitions`](https://cap.cloud.sap/docs/node.js/cds-reflect#iterable). Convert linked definitions into arrays before using these methods, for example:

   ```js
   [...linked.definitions].map(d => d.name)
   ```

## Version 8.1.1 - 2024-08-08

### Fixed

- For `accept-language`, ignore additional options
- Global `describe`, `before`, `beforeAll`, `afterAll` hooks are now writable again. They were accidentally made read-only in 8.0.0.
- Expand to `DraftAdministrativeData` for active instances of draft-enabled entities over drafts
- Deduplication of columns for certain on conditions for the legacy database driver
- For legacy-sqlite/-hana: Add keys to expands with only non-key elements to ensure not returning null for expand.
- New parser was too restrictive regarding an empty line at the end of batch body.
- Error target for operations with complex parameters
- Remote services: JWT gets found in authorization header
- Search with invalid characters
- Invoke `srv.on('error')` for each failing batch subrequest

## Version 8.1.0 - 2024-07-26

### Added

- Streaming of data with content type 'application/json'
- Service annotation `@cds.server.body_parser.limit` and global config option `cds.server.body_parser.limit` allow to configure the maximum request body size in bytes. The default value by express' body parser middleware is 100 kb. See [express docs](https://expressjs.com/en/resources/middleware/body-parser.html) for details.
- Translations for new languages: bg (Bulgarian), el (Greek), he (Hebrew), hr (Croatian), kk (Kazakh), sk (Slovak), sl (Slovenian), sr (Serbian), uk (Ukrainian)

### Changed

- Event Broker: Standardize behaviour for cloud events and header propagation

### Fixed

- Erroneous authentication of `enterprise-messaging`
- `@odata.context` for actions/functions returning an array of <type>
- `cds-deploy` script terminates if deployment fails
- Allow backslashes, quotation marks and ampersands in search terms
- Search compatibility for new parser and old db
- The server startup no longer yields the `WARNING: Package '@sap/cds' was loaded from different installations:` message in PNPM setups with `--global-bin-dir` on. This happened in BAS, for example on `cds watch/serve` etc.

## Version 8.0.4 - 2024-07-19

### Fixed

- Localized views like `localized_de_Books` where accidentially generated for new sqlite service.
- Atomicity group handling in `$batch`
- `$batch` im combination with `commit` hooks
- `continue-on-error` preference for JSON `$batch`

## Version 8.0.3 - 2024-07-12

### Added

- Translations for the technical SAP language `1Q` used in support scenarios, for example for translation issues.  See https://sapui5.hana.ondemand.com/sdk/#/topic/91f21f176f4d1014b6dd926db0e91070 for more.

### Fixed

- Empty feature set by switched off feature toggles
- Allow programmatic operations on draft-enabled entities (`NEW`, `CREATE`, `UPDATE`, `DELETE`)

### Removed

- Allow deviating response types for `$batch`, e. g. input `multipart` and output `json`

## Version 8.0.2 - 2024-07-09

### Added

- `express` is now an optional peer dependency, to indicate to applications to install it as part of their dependencies.  It is needed for all runtime scenarios, but can be omitted for pure designtime cases like `cds compile` calls.

### Changed

- Creation via draft by association is forbidden with `403` response.
- New OData adapter captures input of `$search` as plain val without applying OData grammar.
- ´not null´ is not validated for action/function params. Use `@mandatory` instead.
- REST adapter rejects unknown input if not annotated with `@open`. Previously, it removed the unknown elements from the payload.

### Fixed

- `cds.log(…, 0)` now properly changes log level to `SILENT` if called after the respective logger had already been created.
- `cds.test` recommends version 7 of `chai-as-promised`.  Version 8 is ESM-only and does not work with `cds.test` at the moment.
- Loading of `cds.plugins` now respects the (internal!) property `cds.env.plugins` again.
- Proper error handling for invalid draft requests in combination with `$apply`
- Usage of `Date` values in `cds.ql` expressions
- Error in `enterprise-messaging` deploy script
- Error handling for bad navigation properties (like in `$orderby=prop1/prop2`) in new OData adapter
- Properly forward path expression infront of lamda functions for `odata-v2` remote services

### Removed

- Type information is no longer shipped as part of `@sap/cds`. Instead, the `@cap-js/cds-types` package has to be explicitly installed as devDependency for projects requiring type support. Installing the package is sufficient to add type support back in.
- Invalid annotations `@Common.FieldControl.Mandatory` and `@FieldControl.Mandatory` → use `@Common.FieldControl: #Mandatory` instead
- Invalid annotations `@Common.FieldControl.ReadOnly` and `@FieldControl.ReadOnly` → use `@Common.FieldControl: #ReadOnly` instead

## Version 8.0.1 - 2024-06-20

### Fixed

- always enforce `attic` profile

## Version 8.0.0 - 2024-06-19

### Added

- Profile `[attic]` to quickly test with deprecated features like so `CDS_ENV=attic cds watch` or `CDS_ENV=attic jest`.
- New OData Adapter: Default location header for actions that return an entity (custom handler must set the response status code to 201)
- New `cds.utils` methods `.stack()` and `.location()` to get the stack trace and location of the caller (not publicly released yet).
- Protected the methods inherited from `LinkedDefinitions` prototype against accidental and undetected interpretation and usage as CSN element: An error is thrown, when trying to access one of the usual CSN properties, like `.name`, `.kind`, `.type`, ... on them.
- Escaping single quotes with doubled ones `''` in `.properties` files
- Support for `@sap/xssec^4`
- New OData and REST adapter pass error to next such that a custom error middleware added to `cds.middlewares.after` is called
  + Note: The custom middleware must preceed the default error middleware (if it remains), e.g., by adding via `unshift()`
- Support for extensibility scenarios in RESTful protocol adapters
- The built-in CORS middleware can be enabled explicitly with `cds.server.cors = true`.  By default, this is `false` if in production.
- Remote Service: `useCache` destination option is enabled by default
- New model processor `cds.compile.to.hana` to generate `.hdbtable`, `.hdbview` files including migration table support.
- Added `cds.requires.connectivity` indicating whether SAP BTP Connectivity service is required.
- Support inline where conditions in `@restrict` like `where: (prop = $user.id)`.

### Changed

- Meant for tests only: `cds.User.default` points to a singleton instance of `cds.User` instead of a class now.
- Never public: `express.Request.user` or `.tenant` must not be used anywhere
  > NOTE: that was never public nor guaranteed to exist at all!
  > Always only use `cds.Request.user/tenant` or `cds.context.user/tenant`.
- Never public: `cds.Request.protocol` was 'odata-v4' and is now 'odata'.
- Errors sent to clients now include a stack trace in the `stack` property during development and in tests
  > NEVER test with `.toEqual()` but always only with `.toMatchObject()`.
- Node.js 18 is now the minimum required Node.js version. Version 16 is no longer supported.
- `cds.fiori.draft_deletion_timeout` is enabled with default value `30d`
- `srv.on('error')` is only invoked for errors during `srv.dispatch()`, i.e., for errors that occur while the respective request is being processed by a service instance
  + Specifically, `srv.on('error')` is no longer invoked for an error that occurs in the protocol adapter. Instead, use a custom middleware added to the beginning of `cds.middlewares.after`.
  + This change does not affect the legacy OData adapter.
- In `bypass_draft`, direct active modifications now have event `CREATE` instead of `NEW`.
- `cds compile --to serviceinfo` returns the correct URL path for Java applications.
- The default index page is no longer served if `NODE_ENV` is set to `production`. Set `cds.server.index = true` to restore previous behavior.
- Delete deprecated cds build stub.
- Multiple entries in `cds.requires.<name>.vcap` are now ANDed instead of ORed, so that e.g. multiple bound services of the same kind can be filtered more easily.  For example, `{ "vcap": { "label": "xsuaa", "tag": "broker" }}` can be used to only bind an XSUAA instance (out of many) with the `xsuaa` label AND the `broker` tag.
- Role `cds.Subscriber` removed from predefined mock users.
- REST adapter uses managed transactions
- The default index page got a new design.
- Syntax error in batch body is handled as bad request

### Fixed

- Failing logins with internal pre-release versions from git main branches.
- Prevent inconsistent ordering when selecting messages from outbox
- Creating child-nodes with `@Core.Immutable` fields
- ETag handling in draft cancel
- `if-none-match` with asterisk in update handler
- `odata.mediaContentType` for empty stream is always `null`
- `$select/$expand` large binaries by draft edit and activate does not return large binaries
- Error message for actions/functions with wrong path
- Direct `READ` of entities that are `@cds.autoexposed` when the `cds.env.features.odata_new_adapter` flag is set to `true`
- Reject `PATCH` requests where foreign keys cannot be determined statically or where multiple entities need to be updated
- actions / functions bound to a collection of entities in case `cds.features.odata_new_parser` is enabled
- `cds.compile.to.hana` generates `afterImage` only if migration tables exist.

### Removed

- Legacy leftovers for old middlewares: `ExtensedModel:middleware4` (in combination with extensibility)
- Legacy request header `x-correlationid` which was ajways just a misspelled variant of `x-correlation-id`.
- Legacy configuration option `cds.requires.middlewares = false`
- Legacy configuration option `cds.features.serve_on_root = true`
- Legacy draft implementation `cds.fiori.lean_draft = false`
- Legacy API `req.user.locale`. Use `req.locale` instead.
- Legacy API `req.user.tenant`. Use `req.tenant` instead.
- Legacy configuration `cds.drafts.cancellationTimeout`. Use `cds.fiori.draft_lock_timeout` instead.
- Legacy annotation `@assert.enum`. Use `@assert.range` instead.
- Legacy properties of `cds.Request`: `req.tokenInfo`, `req._.shared`, and `req.attr`
- Legacy type facade files from `@sap/cds/apis/...`. Use `@sap/cds` as only type import.
- Legacy quirks mode. From now on, `cds.ql` generates spec compliant `ref` paths in INSERT/UPDATE/DELETE CQNs. The database services expect the same.
  + Use `{ INSERT: { into: { ref: ['Authors']}}}` instead of `{ INSERT: { into: 'Authors' }}`
  + Use `{ UPDATE: { entity: { ref: ['Authors']}}}` instead of `{ UPDATE: { entity: 'Authors' }}`
  + Use `{ DELETE: { from: { ref: ['Authors']}}}` instead of `{ DELETE: { from: 'Authors' }}`
- Deprecated csn entity proxy `<entity>_texts`. Use `<entity>.texts` instead.
- Deprecated built-in `cds.compile.to.gql` and `cds.compile.to.graphql` compile targets. These are provided by `@cap-js/graphql` plugin versions >= 0.9.0.
- Deprecated API `srv.stream`. Use `SELECT` with a single `cds.LargeBinary` column instead.
