# def-missing-type

A type artifact doesn’t have proper type information.

The message's severity is `Info` but may be raised to `Error` in the SQL,
SAP HANA, and OData backends.  These backends require types to have type
information.  Otherwise, they aren’t able to render elements that use this
type (for example, to SQL columns).

## Example

Erroneous code example:

```json
{
  "definitions": {
    "MainType": {
      "kind": "type"
    }
  }
}
```

`MainType` is of kind "type" but has not further type-information.

## How to Fix

Add explicit type information to `MainType`, for example, add an `elements`
property to make a structured type.

```json
{
  "definitions": {
    "MainType": {
      "kind": "type",
      "elements": {
        "id": {
          "type": "cds.String"
        }
      }
    }
  }
}
```

## Related Messages

- `check-proper-type-of`
