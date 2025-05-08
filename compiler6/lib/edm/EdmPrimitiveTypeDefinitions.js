'use strict';

// facet definitions, optional could either be true or array of edm types
// remove indicates wether or not the canonic facet shall be removed when applying @odata.Type
const EdmTypeFacetMap = {
  MaxLength: {
    v2: true, v4: true, remove: true, optional: true,
  },
  Precision: {
    v2: true, v4: true, remove: true, optional: true,
  },
  Scale: {
    v2: true, v4: true, remove: true, optional: true, extra: 'sap:variable-scale',
  },
  SRID: { v4: true, remove: true, optional: true },
  // 'FixedLength': { v2: true },
  // 'Collation': { v2: true },
  // 'Unicode': { v2: true, v4: true },
};
const EdmTypeFacetNames = Object.keys(EdmTypeFacetMap);

// Merged primitive type map with descriptions taken from V4 spec and filled up with V2 spec
const EdmPrimitiveTypeMap = {
  'Edm.Binary': {
    v2: true,
    v4: true,
    MaxLength: true,
    FixedLength: true,
    max: 1,
    desc: 'Binary data',
  },
  'Edm.Boolean': {
    v2: true,
    v4: true,
    exact: 0,
    desc: 'Binary-valued logic',
  },
  'Edm.Byte': {
    v2: true,
    v4: true,
    exact: 0,
    desc: 'Unsigned 8-bit integer',
  },
  'Edm.Date': {
    v4: true,
    exact: 0,
    desc: 'Date without a time-zone offset',
  },
  'Edm.DateTime': {
    v2: true,
    Precision: true,
    max: 1,
    desc: 'Date and time with values ranging from 12:00:00 midnight, January 1, 1753 A.D. through 11:59:59 P.M, December 31, 9999 A.D.',
  },
  'Edm.DateTimeOffset': {
    v2: true,
    v4: true,
    Precision: true,
    max: 1,
    desc: 'Date and time with a time-zone offset, no leap seconds',
  },
  'Edm.Decimal': {
    v2: true,
    v4: true,
    Precision: true,
    Scale: true,
    max: 2,
    desc: 'Numeric values with decimal representation',
  },
  'Edm.Double': {
    v2: true,
    v4: true,
    exact: 0,
    desc: 'IEEE 754 binary64 floating-point number (15-17 decimal digits)',
  },
  'Edm.Duration': {
    v4: true,
    Precision: true,
    max: 1,
    desc: 'Signed duration in days, hours, minutes, and (sub)seconds',
  },
  'Edm.Guid': {
    v2: true,
    v4: true,
    exact: 0,
    desc: '16-byte (128-bit) unique identifier',
  },
  'Edm.Int16': {
    v2: true,
    v4: true,
    exact: 0,
    desc: 'Signed 16-bit integer',
  },
  'Edm.Int32': {
    v2: true,
    v4: true,
    exact: 0,
    desc: 'Signed 32-bit integer',
  },
  'Edm.Int64': {
    v2: true,
    v4: true,
    exact: 0,
    desc: 'Signed 64-bit integer',
  },
  'Edm.SByte': {
    v2: true,
    v4: true,
    exact: 0,
    desc: 'Signed 8-bit integer',
  },
  'Edm.Single': {
    v2: true,
    v4: true,
    exact: 0,
    desc: 'IEEE 754 binary32 floating-point number (6-9 decimal digits)',
  },
  'Edm.Stream': {
    v4: true,
    MaxLength: true,
    max: 1,
    desc: 'Binary data stream',
  },
  'Edm.String': {
    v2: true,
    v4: true,
    MaxLength: true,
    FixedLength: true,
    Collation: true,
    Unicode: true,
    max: 1,
    desc: 'Sequence of characters',
  },
  'Edm.Time': {
    v2: true,
    Precision: true,
    max: 1,
    desc: 'time of day with values ranging from 0:00:00.x to 23:59:59.y, where x and y depend upon the precision',
  },
  'Edm.TimeOfDay': {
    v4: true,
    Precision: true,
    max: 1,
    desc: 'Clock time 00:00-23:59:59.999999999999',
  },
  'Edm.Geography': {
    v4: true,
    SRID: true,
    max: 1,
    desc: 'Abstract base type for all Geography types',
  },
  'Edm.GeographyPoint': {
    v4: true,
    SRID: true,
    max: 1,
    desc: 'A point in a round-earth coordinate system',
  },
  'Edm.GeographyLineString': {
    v4: true,
    SRID: true,
    max: 1,
    desc: 'Line string in a round-earth coordinate system',
  },
  'Edm.GeographyPolygon': {
    v4: true,
    SRID: true,
    max: 1,
    desc: 'Polygon in a round-earth coordinate system',
  },
  'Edm.GeographyMultiPoint': {
    v4: true,
    SRID: true,
    max: 1,
    desc: 'Collection of points in a round-earth coordinate system',
  },
  'Edm.GeographyMultiLineString': {
    v4: true,
    SRID: true,
    max: 1,
    desc: 'Collection of line strings in a round-earth coordinate system',
  },
  'Edm.GeographyMultiPolygon': {
    v4: true,
    SRID: true,
    max: 1,
    desc: 'Collection of polygons in a round-earth coordinate system',
  },
  'Edm.GeographyCollection': {
    v4: true,
    SRID: true,
    max: 1,
    desc: 'Collection of arbitrary Geography values',
  },
  'Edm.Geometry': {
    v4: true,
    SRID: true,
    max: 1,
    desc: 'Abstract base type for all Geometry types',
  },
  'Edm.GeometryPoint': {
    v4: true,
    SRID: true,
    max: 1,
    desc: 'Point in a flat-earth coordinate system',
  },
  'Edm.GeometryLineString': {
    v4: true,
    SRID: true,
    max: 1,
    desc: 'Line string in a flat-earth coordinate system',
  },
  'Edm.GeometryPolygon': {
    v4: true,
    SRID: true,
    max: 1,
    descr: 'Polygon in a flat-earth coordinate system',
  },
  'Edm.GeometryMultiPoint': {
    v4: true,
    SRID: true,
    max: 1,
    desc: 'Collection of points in a flat-earth coordinate system',
  },
  'Edm.GeometryMultiLineString': {
    v4: true,
    SRID: true,
    max: 1,
    desc: 'Collection of line strings in a flat-earth coordinate system',
  },
  'Edm.GeometryMultiPolygon': {
    v4: true,
    SRID: true,
    max: 1,
    desc: 'Collection of polygons in a flat-earth coordinate system',
  },
  'Edm.GeometryCollection': {
    v4: true,
    SRID: true,
    max: 1,
    desc: 'Collection of arbitrary Geometry values',
  },
  'Edm.PrimitiveType': {
    v4: true,
    exact: 0,
    desc: 'Abstract meta type',
  },
  // 'Edm.Untyped': { v4: true, desc: 'Abstract void type' },
};
const EdmPathTypeMap = {
  'Edm.AnnotationPath': 1,
  'Edm.PropertyPath': 1,
  'Edm.NavigationPropertyPath': 1,
  'Edm.AnyPropertyPath': 1,
  'Edm.ModelElementPath': 1,
  'Edm.Path': 1,
};

module.exports = {
  EdmTypeFacetMap, EdmTypeFacetNames, EdmPrimitiveTypeMap, EdmPathTypeMap,
};
