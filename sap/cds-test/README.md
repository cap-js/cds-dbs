# Test Support for CAP Node.js

## About this project

This is a library with test utilities for CAP Node.js applications, like
- Starting and stopping a CAP server before and after tests
- A bound HTTP client for the server
- `chai`-like assertion helpers

## Requirements and Setup

In your application project, just install the package as dev dependency:
```sh
npm add -D @cap-js/cds-test
```

## Usage

Add a simple test file `test/bookshop.test.js ` with this content:
```js
const cds = require('@sap/cds')

describe('Sample tests', () => {
  const { GET, expect } = cds.test (__dirname+'/..')

  it('serves Books', async () => {
    const { data } = await GET `/odata/v4/catalog/Books`
    expect(data.value.length).to.be.greaterThanOrEqual(5)
  })
})
```

Run it with Jest, for example:
```sh
npx jest
```

`node --test` and `mocha` runners are supported, too, though with less coverage in real-life projects.

## Documentation

See the [CAP documentation on `cds.test`](https://cap.cloud.sap/docs/node.js/cds-test) for more.


## Support, Feedback, Contributing

This project is open to feature requests/suggestions, bug reports etc. via [GitHub issues](https://github.com/cap-js/cds-test/issues). Contribution and feedback are encouraged and always welcome. For more information about how to contribute, the project structure, as well as additional contribution information, see our [Contribution Guidelines](CONTRIBUTING.md).

## Security / Disclosure
If you find any bug that may be a security problem, please follow our instructions at [in our security policy](https://github.com/cap-js/.github/blob/main/SECURITY.md) on how to report it. Please do not create GitHub issues for security-related doubts or problems.

## Code of Conduct

We as members, contributors, and leaders pledge to make participation in our community a harassment-free experience for everyone. By participating in this project, you agree to abide by its [Code of Conduct](https://github.com/cap-js/.github/blob/main/CODE_OF_CONDUCT.md) at all times.

## Licensing

Copyright 2024-2025 SAP SE or an SAP affiliate company and cds-test contributors. Please see our [LICENSE](LICENSE) for copyright and license information. Detailed information including third-party components and their licensing/copyright information is available [via the REUSE tool](https://api.reuse.software/info/github.com/cap-js/cds-test).
