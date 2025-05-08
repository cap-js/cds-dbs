'use strict';

const { isBuiltinType } = require('../base/builtins');
const { transformAnnotationExpression } = require('../model/csnUtils');
/**
 *
 * @param {object} member
 */
function checkAnnotationExpression( member, _memberName, _prop, path ) {
  Object.keys(member).filter(pn => pn[0] === '@').forEach((anno) => {
    transformAnnotationExpression(member, anno, {
      ref: (elemref, __prop, _ref, refPath) => {
        const { art, scope } = this.csnUtils.inspectRef(refPath);
        if (scope !== '$magic' && art) {
          const ft = this.csnUtils.getFinalTypeInfo(art.type);
          if (!isBuiltinType(ft?.type) && !ft?.items)
            this.error('odata-anno-xpr-ref', refPath, { anno, elemref, '#': 'flatten_builtin_type' });
        }
      },
    }, path);
  });
}

module.exports = {
  checkAnnotationExpression,
};
