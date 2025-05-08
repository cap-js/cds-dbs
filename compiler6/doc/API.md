# CDS Compiler API Documentation

The API of `@sap/cds-compiler` is described in a TypeScript declaration file
[`main.d.ts`](../lib/main.d.ts).

Refer to that file for documentation on option names, API calls, and more.

You can use [TypeDoc] to render an HTML documentation from it.

## Important Notes

The cds-compiler expects that `Object.prototype` is not polluted by enumerable
properties.  Non-enumerable properties such as custom functions are fine.


[TypeDoc]: https://typedoc.org/
