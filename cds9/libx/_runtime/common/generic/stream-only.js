// Parked variant of ./stream.js that registers handlers not to all services,
// but only to the ones that actually have media type elements.
const cds = require('../../cds')

module.exports = cds.service.impl(function () {
  for (let each of this.entities) {
    if (_is_irrelevant(each)) continue
    for (let e in each.elements) {
      const ref = _media_type_ref4(each.elements[e])
      if (ref) {
        this.before('UPDATE', _entity(each), function fill_media_type(req) {
          if (e in req.data && _is_field_request(req)) {
            let content_type = req.req?.get('content-type')
            if (_is_valid(content_type)) req.data[ref] = content_type
          }
        })
      }
    }
  }
})

const _is_irrelevant = d => d['@readonly'] || d.name.endsWith('.texts')
const _entity = d => (!d.drafts ? d : [d, d.drafts])
const _media_type_ref4 = media_element => media_element['@Core.MediaType']?.['=']
const _is_field_request = req => req.req?._query?._propertyAccess
const _is_valid = content_type => content_type && !content_type.includes('multipart')
