# Versioning

The cds-compiler uses [Semantic Versioning][SemVer] for its version numbers.

This document clarifies how we use [SemVer] and what you can and what you can‘t
expect from version updates.

<!-- toc: start -->

1. [Public API](#public-api)
2. [Patch Versions](#patch-versions)
3. [Minor Versions](#minor-versions)
4. [Beta Flags](#beta-flags)
5. [Deprecated Flags](#deprecated-flags)
6. [Command Line Tool `cdsc`](#command-line-tool-cdsc)

<!-- toc: end -->

## Public API

According to [§1] of SemVer, a public API must be made available.  Our public
API is available through `lib/main.js` which can be used via
`const compiler = require('@sap/cds-compiler');` in Node.js or, if you use
ES modules, via `import compiler from "@sap/cds-compiler";`

Furthermore, any exported property in `lib/main.js` whose name starts with `$`
is _not_ part of the public API.

Using any other file is not considered “public” and is not covered by any
guarantees about API stability.

## Patch Versions

In [§6] of SemVer, it is stated that only “backwards compatible bug fixes” are
to be introduced by patch versions.  And “A bug fix is defined as an internal
change that fixes incorrect behavior.”

We _may_ introduce new compiler-checks in patch versions that catch incorrect
CDS which may lead to invalid SQL or EDM(X) files.  Therefore, if your code
contains invalid CDS, a patch release may make them visible and CDS files _may_
fail to compile.  
However, most of the time, new errors are first introduced as warnings and are
only later upgraded to errors.

## Minor Versions

[§7] of SemVer covers minor version updates.  The same exceptions as for
“patch versions” can be applied.

We may introduce new compiler-checks that might make your compilation fail if
we detect invalid CDS code.  OData vocabularies may be updated.

## Beta Flags

The compiler provides so-called “beta flags” that enable or disable certain
features.  We do not guarantee that any such flags stay consistent between
patch versions!  Beta flags may change any time.

Refer to [CHANGELOG_BETA.md](./CHANGELOG_BETA.md) for changes to beta flags.

## Deprecated Flags

“Deprecated flags” allow developers to switch to old behavior and make it
easier to upgrade to a later major version.  These flags may be changed or
removed anytime as they only serve to make upgrades easier during a grace
period.

Refer to [CHANGELOG_DEPRECATED.md](./CHANGELOG_DEPRECATED.md) for changes
to deprecated flags.

## Command Line Tool `cdsc`

`bin/cdsc.js` as well as all other command line tools do _not_ guarantee any
stability.  It is considered a compiler internal tool that only serves for
debugging.  The official command line tool `cds` of the `@sap/cds` and
`@sap/cds-dk` packages are to be used by users.  That means commands and
options may change any time without prior notice.  Changes may still be listed
in [CHANGELOG.md](../CHANGELOG.md).

[SemVer]: https://semver.org/
[§1]: https://semver.org/#spec-item-1
[§6]: https://semver.org/#spec-item-6
[§7]: https://semver.org/#spec-item-7
