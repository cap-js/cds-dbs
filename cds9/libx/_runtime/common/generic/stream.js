const cds = require('../../cds')

// register after input.js in order to write content-type also for @Core.Computed fields
module.exports = cds.service.impl(function () {
  this.before('UPDATE', '*', function fill_media_types(req) {
    if (!req.data || !req.target) return
    if (_is_field_request(req)) {
      for (let e in req.data) {
        let ref = _media_type_ref4(req.target.elements[e])
        if (ref) {
          let content_type = req.req?.get('content-type')
          if (_is_valid(content_type)) req.data[ref] = content_type
        }
      }
    }
  })
})

const _media_type_ref4 = media_element => media_element['@Core.MediaType']?.['=']
const _is_field_request = req => req.req?._query?._propertyAccess
const _is_valid = content_type => content_type && !content_type.includes('multipart')
