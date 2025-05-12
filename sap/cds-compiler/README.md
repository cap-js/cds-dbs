# Getting started

<!-- markdownlint-disable MD001 MD022 -->
##### Table of Contents
<!-- markdownlint-enable MD001 MD022 -->

[Installation and Usage](#installation-and-usage)  
<!-- begin internal -->
[Command invocation](#command-invocation)  
[Build from source](#build-from-source)  
<!-- end internal -->
[Documentation](#documentation)

## Installation and Usage

Install with npm:

```
npm install "@sap/cds-compiler"
```

Or maintain your package.json dependencies as follows:

```
  "dependencies": {
    "@sap/cds-compiler": "latest"
  }
```

<!-- begin internal -->

### Install from Artifactory

`@sap/cds-compiler` is available on Artifactory. There are release builds, milestones
and snapshots.

```sh
# Releases
npm install --@sap/registry="https://int.repositories.cloud.sap/artifactory/api/npm/build-releases-npm/" @sap/cds-compiler
# Milestones
npm install --@sap/registry="https://int.repositories.cloud.sap/artifactory/api/npm/build-milestones-npm/" @sap/cds-compiler
# Snapshots: List available versions first, then install specific version.
npm view --@sap:registry="https://int.repositories.cloud.sap/artifactory/api/npm/build-snapshots-npm/" @sap/cds-compiler versions
npm install --@sap:registry="https://int.repositories.cloud.sap/artifactory/api/npm/build-snapshots-npm/" @sap/cds-compiler@<version>
```

### Command Invocation

The compiler with its options is invoked like any other npm/Unix command:

```bash
cdsc <command> [options] <file...>
```
See `cdsc --help` for commands and options.

The exit code of the process is:

* `0`: successful compilation
* `1`: compiled with error (the command invocation itself is ok)
* `2`: command invocation error (invalid options, repeated file name)

### Build from source

We recommend to install `cds-compiler` using npm. If you want to use
the latest code (for example, for testing purposes) then you need to set up the
compiler first:

```sh
git clone --recursive https://github.tools.sap/cap/cds-compiler.git
cd cds-compiler
git submodule update --init
npm install
npm run download --artifactory # Downloads Antlr (Java Dependency)
                               # Without option, it uses the public Maven repository.
npm run gen                    # Generates the parser
./bin/cdsc.js --help
```
<!-- end internal -->

## Documentation

Please refer to the [official CDS documentation](https://cap.cloud.sap/docs/cds/).

## How to Obtain Support

In case you find a bug, please report an [incident](https://cap.cloud.sap/docs/resources/#reporting-incidents) on SAP Support Portal.

## License

This package is provided under the terms of the [SAP Developer License Agreement](https://cap.cloud.sap/resources/license/developer-license-3_2_CAP%20V2.txt).
