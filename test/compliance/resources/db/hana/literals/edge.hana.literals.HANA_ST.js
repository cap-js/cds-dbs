// TODO: Add HANA TYPE EXPECTATIONS
module.exports = [
  {
    point: null,
  },
  {
    point: 'POINT(1 1)',
  },
  {
    point: '0101000000000000000000F03F000000000000F03F',
  },
  {
    // GeoJSON specification: https://www.rfc-editor.org/rfc/rfc7946
    point: '{"x":1,"y":1,"spatialReference":{"wkid":4326}}',
  },
]
