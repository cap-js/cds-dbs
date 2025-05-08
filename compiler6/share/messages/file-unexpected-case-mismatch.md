# file-unexpected-case-mismatch

The filename of a `using` statement does not match
the file's actual name on disk.

To avoid operating-system dependent issues, the compiler checks if the name of
an imported file matches the name of the file in the filesystem / on disk.
For example, by default macOS uses a case-insensitive file system.
Hence, a file named `model.cds` will also be loaded by `using from './Model.cds'`
on such systems.

However, on other filesystems that are case-sensitive, e.g. when building your
application in another environment, the file will not be found.

Hence, the `using` statement needs to be adapted.

## Example

Erroneous code example:

```cds
// index.cds
using from './Model';
```

using following directory tree:

```
├── index.cds
└── model.cds
```

On case-insensitive systems, the file can be loaded, but the compiler will warn
about the mismatch.
On case-sensitive file systems, compilation will fail, as the imported file
can't be found.

While in this case, compilation will fail on case-sensitive systems, it could
instead end up with semantic changes, too.
Given the same `index.cds`, but a different directory tree:

```
├── index.cds
├── Model
│   └── index.cds
└── model.cds
```

On case-sensitive systems, `./Model/index.cds` will be loaded.
On case-insensitive systems, however, `model.cds` will be loaded,
as the compiler first tries to load `Model.cds`, before looking for
`Model/index.cds`.


## How to Fix

Adapt the filename in your `using` statement.

If you have both `model.cds` and `Model/index.cds`, but don't want to use
a `.cds` suffix, use `using from './Model/'`, i.e. add a trailing slash to
indicate that you want to load from the folder `Model`.
