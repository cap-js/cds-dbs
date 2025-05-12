// Base classes used as prototypes for XSN definitions, elements, etc.
// The goal is to have named classes that can be seen in performance analyses, e.g.
// by using the [DeOpt Explorer][1].
// All classes should also be constructible using `{ __proto__: Class, …}`, i.e.
// their constructors must not do anything besides assigning properties.
//
// Refer to these resources:
// - <https://mathiasbynens.be/notes/shapes-ics>
// - <https://v8.dev/blog/fast-properties>
//
// Before adding new properties, evaluate whether it has any performance
// impact.  Too many properties that are rarely used could reduce performance,
// but too few could lead to inconsistent object shapes for commonly
// used properties.
//
// Use [DeOpt Explorer][1] to see the different object Maps by v8.
//
// [1]: https://devblogs.microsoft.com/typescript/introducing-deopt-explorer/

'use strict';

class XsnSource {               // TODO: should be subclass of XsnArtifact
  kind = 'source';
  location;
  usings = [];
  dependencies = [];
  artifacts = Object.create( null );
  vocabularies = Object.create( null );
  extensions = [];
  $frontend;
  constructor( frontend ) {
    this.$frontend = frontend;
  }
}

class XsnArtifact {
  location;
  name;
  kind;
}

class XsnName {
  location;
}

module.exports = {
  XsnSource,
  XsnArtifact,
  XsnName,
};
