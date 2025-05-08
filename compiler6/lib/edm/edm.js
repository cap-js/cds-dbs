'use strict';

const edmUtils = require('./edmUtils');
const { isBuiltinType } = require('../base/builtins');
const { forEach } = require('../utils/objectUtils');
const {
  EdmTypeFacetMap,
  EdmTypeFacetNames,
  EdmPrimitiveTypeMap,
} = require('./EdmPrimitiveTypeDefinitions.js');

function getEdm( options, messageFunctions ) {
  const { error } = messageFunctions || { error: () => true, warning: () => true };
  class Node {
    /**
     * @param {boolean[]} version Versions in the form of [<v2>, <v4>].
     * @param {object} attributes
     * @param {CSN.Model} csn
     */
    constructor(version, attributes = Object.create(null), csn = undefined) {
      if (!attributes || typeof attributes !== 'object')
        error(null, 'Debug me: attributes must be a dictionary');
      if (!Array.isArray(version))
        error(null, `Debug me: v is either undefined or not an array: ${ version }`);
      if (version.filter(v => v).length !== 1)
        error(null, 'Debug me: exactly one version must be set');

      // Common attributes of JSON and XML.
      // Note: Can't assign attributes directly, due to the input object being modified.
      //       The caller re-uses the object for other nodes.
      this._edmAttributes = Object.assign(Object.create(null), attributes);
      this._xmlOnlyAttributes = Object.create(null);
      this._jsonOnlyAttributes = Object.create(null);
      this._openApiHints = Object.create(null);

      this._children = [];
      this._ignoreChildren = false;
      this._v = version;

      if (this.v2)
        this.setSapVocabularyAsAttributes(csn);

      this.setOpenApiHints(csn);
    }

    get v2() {
      return this._v[0];
    }
    get v4() {
      return this._v[1];
    }

    get kind() {
      return this.constructor.name;
    }

    /**
     * Set the EDM(X) attribute on the Node.
     * @param {string} key
     * @param {any} value
     */
    setEdmAttribute(key, value) {
      if (key !== undefined && key !== null && value !== undefined && value !== null)
        this._edmAttributes[key] = value;
    }

    /**
     * Remove the EDM(X) attribute on the Node.
     * @param {string} name
     */
    removeEdmAttribute(name) {
      if (name in this._edmAttributes)
        delete this._edmAttributes[name];
      if (name in this._xmlOnlyAttributes)
        delete this._xmlOnlyAttributes[name];
    }

    /**
     * Set properties that should only appear in the XML representation
     * @param {object} attributes
     * @return {any}
     */
    setXml(attributes) {
      return Object.assign(this._xmlOnlyAttributes, attributes);
    }

    /**
     * Set properties that should only appear in the JSON representation.
     * Today JSON attributes are not rendered in toJSONattributes()
     *
     * @param {object} attributes
     * @return {any}
     */
    setJSON(attributes) {
      return Object.assign(this._jsonOnlyAttributes, attributes);
    }

    prepend(...children) {
      this._children.splice(0, 0, ...children.filter(c => c));
      return this;
    }

    append(...children) {
      // remove undefined entries
      this._children.push(...children.filter(c => c));
      return this;
    }

    setOpenApiHints(csn) {
      if (csn && options.odataOpenapiHints) {
        const jsonAttr = Object.create(null);
        Object.entries(csn).filter(([ k, _v ] ) => k.startsWith('@OpenAPI.')).forEach(([ k, v ]) => {
          jsonAttr[k] = v;
        });
        Object.assign(this._openApiHints, jsonAttr);
      }
      return this._openApiHints;
    }

    // virtual
    toJSON() {
      const json = Object.create(null);
      // $kind Property MAY be omitted in JSON for performance reasons
      if (!(this.kind in Node.noJsonKinds))
        json.$Kind = this.kind;

      return this.toJSONchildren(this.toJSONattributes(json));
    }

    // virtual
    toJSONattributes(json, withHints = true) {
      forEach(this._edmAttributes, (p, v) => {
        if (p !== 'Name')
          json[p[0] === '@' ? p : `$${ p }`] = v;
      });
      return (withHints ? this.toOpenApiHints(json) : json);
    }

    toOpenApiHints(json) {
      if (options.odataOpenapiHints && this._openApiHints) {
        Object.entries(this._openApiHints).forEach(([ p, v ]) => {
          json[p[0] === '@' ? p : `$${ p }`] = v;
        });
      }
      return json;
    }

    // virtual
    toJSONchildren(json) {
      // any child with a Name should be added by its name into the JSON object
      // all others must overload toJSONchildren()
      this._children.filter(c => c._edmAttributes.Name).forEach((c) => {
        json[c._edmAttributes.Name] = c.toJSON();
      });
      return json;
    }

    // virtual
    toXML(indent = '', what = 'all') {
      const { kind } = this;
      let head = `${ indent }<${ kind }`;

      if (kind === 'Parameter' && this._edmAttributes.Collection) {
        delete this._edmAttributes.Collection;
        this._edmAttributes.Type = `Collection(${ this._edmAttributes.Type })`;
      }

      head += this.toXMLattributes();

      const inner = this.innerXML(`${ indent }  `, what);
      if (inner.length < 1)
        head += '/>';

      else if (inner.length < 77 && inner.indexOf('<') < 0)
        head += `>${ inner.slice(indent.length + 1, -1) }</${ kind }>`;

      else
        head += `>\n${ inner }${ indent }</${ kind }>`;

      return head;
    }

    // virtual
    toXMLattributes() {
      let tmpStr = '';
      forEach(this._edmAttributes, (p, v) => {
        if (v !== undefined && typeof v !== 'object')
          tmpStr += ` ${ p }="${ edmUtils.escapeStringForAttributeValue(v) }"`;
      });
      forEach(this._xmlOnlyAttributes, (p, v) => {
        if (v !== undefined && typeof v !== 'object')
          tmpStr += ` ${ p }="${ edmUtils.escapeStringForAttributeValue(v) }"`;
      });
      return tmpStr;
    }

    // virtual
    innerXML(indent, what = 'all') {
      let xml = '';

      this._children.forEach((e) => {
        xml += `${ e.toXML(indent, what) }\n`;
      });
      return xml;
    }

    // virtual
    setSapVocabularyAsAttributes(csn, useSetAttributes = false) {
      if (csn) {
        const attr = (useSetAttributes ? csn._SetAttributes : csn);
        if (attr) {
          Object.entries(attr).forEach(([ p, v ]) => {
            if (p.match(/^@sap./))
              this.setXml( { [`sap:${ p.slice(5).replace(/\./g, '-') }`]: v } );
          });
        }
      }
    }
  }

  // $kind Property MAY be omitted in JSON for performance reasons
  Node.noJsonKinds = {
    Property: 1, EntitySet: 1, ActionImport: 1, FunctionImport: 1, Singleton: 1, Schema: 1,
  };

  class Reference extends Node {
    constructor(version, details) {
      super(version, details);
      if (this.v2)
        this._edmAttributes['xmlns:edmx'] = 'http://docs.oasis-open.org/odata/ns/edmx';
    }

    get kind() {
      return 'edmx:Reference';
    }

    toJSON() {
      const json = Object.create(null);
      const includes = [];

      this._children.forEach(c => includes.push(c.toJSON()));
      if (includes.length > 0)
        json.$Include = includes;
      return json;
    }
  }

  class Include extends Node {
    get kind() {
      return 'edmx:Include';
    }
    toJSON() {
      const json = Object.create(null);
      return this.toJSONattributes(json);
    }
  }

  class EntityContainer extends Node {
    constructor(version, attributes, csn) {
      super(version, attributes, csn);
      this._registry = Object.create(null);
    }
    // use the _SetAttributes
    setSapVocabularyAsAttributes(csn) {
      super.setSapVocabularyAsAttributes(csn, true);
    }

    toJSONattributes(json) {
      return super.toJSONattributes(json, false);
    }

    register(entry) {
      if (!this._registry[entry._edmAttributes.Name])
        this._registry[entry._edmAttributes.Name] = [ entry ];
      else
        this._registry[entry._edmAttributes.Name].push(entry);
      this.append(entry);
    }
  }

  class Schema extends Node {
    constructor(version, ns, alias = undefined, serviceCsn = null, annotations = [], withEntityContainer = true) {
      const props = { Namespace: ns };
      if (alias !== undefined)
        props.Alias = alias;
      super(version, props);
      this.setOpenApiHints(serviceCsn);
      this._annotations = annotations;
      this._actions = Object.create(null);
      this.setXml( { xmlns: (this.v2) ? 'http://schemas.microsoft.com/ado/2008/09/edm' : 'http://docs.oasis-open.org/odata/ns/edm' } );

      if (this.v2 && serviceCsn)
        this.setSapVocabularyAsAttributes(serviceCsn);

      if (withEntityContainer) {
        const ecprops = { Name: 'EntityContainer' };
        const ec = new EntityContainer(version, ecprops, serviceCsn );
        if (this.v2)
          ec.setXml( { 'm:IsDefaultEntityContainer': true } );
        // append for rendering, ok ec has Name
        this.append(ec);
        // set as attribute for later access...
        this._ec = ec;
      }
    }

    // hold actions and functions in V4
    addAction(action) {
      if (this._actions[action._edmAttributes.Name])
        this._actions[action._edmAttributes.Name].push(action);
      else
        this._actions[action._edmAttributes.Name] = [ action ];
    }

    setAnnotations(annotations) {
      if (Array.isArray(annotations) && annotations.length > 0)
        this._annotations.push(...annotations);
    }

    innerXML(indent, what) {
      let xml = '';
      if (what === 'metadata' || what === 'all') {
        xml += super.innerXML(indent);
        if (this._actions) {
          Object.values(this._actions).forEach((actionArray) => {
            actionArray.forEach((action) => {
              xml += `${ action.toXML(indent, what) }\n`;
            });
          });
        }
      }
      if ((what === 'annotations' || what === 'all') && this._annotations.length > 0) {
        this._annotations.filter(a => a._edmAttributes.Term).forEach((a) => {
          xml += `${ a.toXML(indent) }\n`;
        });
        this._annotations.filter(a => a._edmAttributes.Target).forEach((a) => {
          xml += `${ a.toXML(indent) }\n`;
        });
      }
      return xml;
    }

    // no $Namespace
    toJSONattributes(json) {
      if (this._edmAttributes) {
        Object.entries(this._edmAttributes).forEach(([ p, v ]) => {
          if (p !== 'Name' && p !== 'Namespace')
            json[p[0] === '@' ? p : `$${ p }`] = v;
        });
      }
      return this.toOpenApiHints(json);
    }

    toJSONchildren(json) {
      // 'edmx:DataServices' should not appear in JSON
      // Annotations first
      this._children.filter(c => c._edmAttributes.Term).forEach((c) => {
        json = { ...json, ...c.toJSON() };
      });

      json = super.toJSONchildren(json);
      if (this._annotations.length > 0) {
        this._annotations.filter(a => a._edmAttributes.Term).forEach((a) => {
          Object.entries(a.toJSON()).forEach(([ n, v ]) => {
            json[n] = v;
          });
        });
        const jsonAnnotations = Object.create(null);
        this._annotations.filter(a => a._edmAttributes.Target).forEach((a) => {
          jsonAnnotations[a._edmAttributes.Target] = a.toJSON();
        });
        if (Object.keys(jsonAnnotations).length)
          json.$Annotations = jsonAnnotations;
      }
      if (this._actions) {
        Object.entries(this._actions).forEach(([ actionName, actionArray ]) => {
          json[actionName] = [];
          actionArray.forEach((action) => {
            json[actionName].push(action.toJSON());
          });
        });
      }

      return json;
    }
  }

  class DataServices extends Node {
    constructor(v) {
      super(v);
      this._schemas = Object.create(null);

      if (this.v2)
        this.setXml( { 'm:DataServiceVersion': '2.0' } );
    }

    get kind() {
      return 'edmx:DataServices';
    }

    registerSchema(fqName, schema) {
      if (!this._schemas[fqName]) {
        this._schemas[fqName] = schema;
        super.append(schema);
      }
    }

    toJSONchildren(json) {
      // 'edmx:DataServices' should not appear in JSON
      this._children.forEach((s) => {
        json[s._edmAttributes.Namespace] = s.toJSON();
      });
      return json;
    }
  }

  /* <edmx:Edmx> must contain exactly one <edmx:DataServices> with 1..n <edm:Schema> elements
                  may contain 0..n <edmx:Reference> elements

      For Odata 1.0..3.0 EDMX is an independent container with its own version 1.0.
      The OData version can be found at the DataServices Version attribute.
      From OData 4.0 onwards, EDMX is no longer a separate 'container' object but
      is used for OData exclusively. Therefore the version attribute reflects the
      OData version
    */

  class Edm extends Node {
    constructor(version, service) {
      super(version, { Version: (version[1]) ? '4.0' : '1.0' });
      this._service = service;
      this._defaultRefs = [];

      const xmlProps = Object.create(null);
      if (this.v4) {
        xmlProps['xmlns:edmx'] = 'http://docs.oasis-open.org/odata/ns/edmx';
        xmlProps['xmlns:m'] = undefined;
        xmlProps['xmlns:sap'] = undefined;
      }
      else {
        xmlProps['xmlns:edmx'] = 'http://schemas.microsoft.com/ado/2007/06/edmx';
        xmlProps['xmlns:m'] = 'http://schemas.microsoft.com/ado/2007/08/dataservices/metadata';
        xmlProps['xmlns:sap'] = 'http://www.sap.com/Protocols/SAPData';
      }
      this.setXml(xmlProps);
    }

    get kind() {
      return 'edmx:Edmx';
    }

    getAnnotations(schemaIndex = 0) {
      if (this._service && this._service._children[schemaIndex])
        return this._service._children[schemaIndex]._annotations;
      return undefined;
    }

    setAnnotations(annotations, schemaIndex = 0) {
      if (this._service && this._service._children[schemaIndex])
        this._service._children[schemaIndex]._annotations = annotations;
    }

    toJSON() {
      const schema = this._service._children[0];

      const json = Object.create(null);
      json.$Version = this._edmAttributes.Version;
      json.$EntityContainer = `${ schema._edmAttributes.Namespace }.${ schema._ec._edmAttributes.Name }`;

      const referenceJson = Object.create(null);
      this._defaultRefs.forEach((r) => {
        referenceJson[r._edmAttributes.Uri] = r.toJSON();
      });
      this._children.forEach((r) => {
        referenceJson[r._edmAttributes.Uri] = r.toJSON();
      });

      if (Object.keys(referenceJson).length)
        json.$Reference = referenceJson;

      this._service.toJSONattributes(json);
      return this._service.toJSONchildren(json);
    }

    // all(default), metadata, annotations
    toXML(what = 'all') {
      return `<?xml version="1.0" encoding="utf-8"?>\n${ super.toXML('', what) }`;
    }

    innerXML(indent, what) {
      let xml = '';

      if (this.v4 || (this.v2 && (what === 'all' || what === 'annotations'))) {
        this._defaultRefs.forEach((r) => {
          xml += `${ r.toXML(indent) }\n`;
        });
      }
      this._children.forEach((e) => {
        xml += `${ e.toXML(indent) }\n`;
      });
      xml += `${ this._service.toXML(indent, what) }\n`;
      return xml;
    }
  }

  class Singleton extends Node {
    toJSONattributes(json) {
      forEach(this._edmAttributes, (p, v) => {
        if (p !== 'Name') {
          if (p === 'EntityType') // it's $Type in json
            json.$Type = v;
          else
            json[p[0] === '@' ? p : `$${ p }`] = v;
        }
      });
      return json;
    }

    toJSONchildren(json) {
      const jsonNavPropBinding = Object.create(null);
      this._children.forEach((npb) => {
        jsonNavPropBinding[npb._edmAttributes.Path] = npb._edmAttributes.Target;
      });
      if (Object.keys(jsonNavPropBinding).length > 0)
        json.$NavigationPropertyBinding = jsonNavPropBinding;

      return json;
    }

    getDuplicateMessage() {
      return `EntityType "${ this._edmAttributes.EntityType }"`;
    }
  }

  class EntitySet extends Singleton {
    // use the _SetAttributes
    setSapVocabularyAsAttributes(csn) {
      super.setSapVocabularyAsAttributes(csn, true);
    }

    toJSONattributes(json) {
      //  OASIS ODATA-1231 $Collection=true
      json.$Collection = true;
      return super.toJSONattributes(json);
    }
  }

  class PropertyRef extends Node {
    constructor(version, Name, Alias) {
      super(version, (Alias) ? { Name, Alias } : { Name });
    }

    toJSON() {
      return this._edmAttributes.Alias ? { [this._edmAttributes.Alias]: this._edmAttributes.Name } : this._edmAttributes.Name;
    }
  }

  class Key extends Node {
    // keys is an array of [name] or [name, alias]
    constructor(version, keys) {
      super(version);
      if (keys && keys.length > 0)
        keys.forEach(k => this.append(new PropertyRef(version, ...k)));
    }

    toJSON() {
      const json = [];
      this._children.forEach(c => json.push(c.toJSON()));
      return json;
    }
  }

  /* Base class to Action/Function that provides
  overloaded XML and JSON rendering of parameters and
  return type. Parameters are _children.
  _returnType holds the eventually existing ReturnType in V4.
  In V2 the return type is a direct attribute called ReturnType
  to the FunctionImport. See comment in class FunctionImport.
  */

  class ActionFunctionBase extends Node {
    constructor(version, details, csn) {
      super(version, details, csn);
      this._returnType = undefined;
    }

    innerXML(indent) {
      let xml = super.innerXML(indent);
      if (this._returnType !== undefined)
        xml += `${ this._returnType.toXML(indent) }\n`;
      return xml;
    }

    toJSONchildren(json) {
      const jsonParameters = [];
      this._children.forEach(p => jsonParameters.push(p.toJSON()));
      if (jsonParameters.length > 0)
        json.$Parameter = jsonParameters;
      if (this._returnType)
        json.$ReturnType = this._returnType.toJSON();

      return json;
    }
  }
  // FunctionDefinition should be named 'Function', but this would
  // collide with a method 'Function' of the Istanbul/NYC tool
  class FunctionDefinition extends ActionFunctionBase {
    get kind() {
      return 'Function';
    }
  }
  class Action extends ActionFunctionBase {}

  /* FunctionImport is derived from ActionFunctionBase
  because in V2 Parameters need to be rendered as sub elements
  to Function Import. The ReturnType property is set in the
  assembly code above (the invisible returnType is left undefined)
  */
  class FunctionImport extends Node {
    getDuplicateMessage() {
      return `Function "${ this._edmAttributes.Name }"`;
    }
  } // ActionFunctionBase {}
  class ActionImport extends Node {
    getDuplicateMessage() {
      return `Action "${ this._edmAttributes.Name }"`;
    }
  }

  class TypeBase extends Node {
    constructor(version, attributes, csn, typeName = 'Type') {
      // ??? Is CSN still required? NavProp?
      super(version, attributes, csn);
      this._typeName = typeName;
      this._scalarType = undefined;
      if (this._edmAttributes[typeName] === undefined) {
        const typecsn = csn.type ? csn : (csn.items && csn.items.type ? csn.items : csn);
        // Complex/EntityType are derived from TypeBase
        // but have no type attribute in their CSN
        if (typecsn.type) { // this thing has a type
          // check whether this is a scalar type (or array of scalar type) or a named type
          if (typecsn.items && typecsn.items.type &&
            isBuiltinType(typecsn.items.type))
            this._scalarType = typecsn.items;

          else if (isBuiltinType(typecsn.type))
            this._scalarType = typecsn;

          if (this._scalarType) {
            this._edmAttributes[typeName] = csn._edmType;
            // CDXCORE-CDXCORE-173 ignore type facets for Edm.Stream
            // cds-compiler/issues/7835: Only set length for Binary as long as it is
            // unclear how many bytes a string character represents.
            // We can't calculate an unambiguous byte stream length for DB dependent
            // multi-byte characters.
            if (!(this._edmAttributes[typeName] === 'Edm.Stream' &&
               !( /* scalarType.type === 'cds.String' || */ this._scalarType.type === 'cds.Binary')))
              edmUtils.addTypeFacets(this, this._scalarType);
          }
          else {
            // it's either _edmType or type (_edmType only used for explicit binding param)
            this._edmAttributes[typeName] = typecsn._edmType || typecsn.type;
          }
        }
        // CDXCORE-245:
        // map type to @odata.Type
        // optionally add @odata { MaxLength, Precision, Scale, SRID }
        // but only in combination with @odata.Type
        // Allow to override type only on scalar and undefined types
        if ((this._scalarType || typecsn.type == null) && !csn.elements) {
          const odataType = csn['@odata.Type'];
          if (odataType) {
            const td = EdmPrimitiveTypeMap[odataType];
            // If type is known, it must be available in the current version
            // Reason: EDMX Importer may set `@odata.Type: 'Edm.DateTime'` on imported V2 services
            // Not filtering out this incompatible type here in case of a V4 rendering would
            // produce an unrecoverable error.
            if (td && (td.v2 === this.v2 || td.v4 === this.v4)) {
              this.setEdmAttribute(typeName, odataType);
              EdmTypeFacetNames.forEach((facetName) => {
                const facet = EdmTypeFacetMap[facetName];
                if (facet.remove) {
                  this.removeEdmAttribute(facetName);
                  this.removeEdmAttribute(facet.extra);
                }
                if (td[facetName] !== undefined &&
                      (facet.v2 === this.v2 ||
                      facet.v4 === this.v4)) {
                  if (this.v2 && facetName === 'Scale' && csn[`@odata.${ facetName }`] === 'variable')
                    this.setXml({ [facet.extra]: true });
                  else
                    this.setEdmAttribute(facetName, csn[`@odata.${ facetName }`]);
                }
              });
            }
          }
        }
      }

      // Set the collection property if this is either an element, parameter or a term def
      this.$isCollection = (csn.kind === undefined || csn.kind === 'annotation') ? csn.$isCollection : false;

      if (options.whatsMySchemaName && this._edmAttributes[typeName]) {
        const schemaName = options.whatsMySchemaName(this._edmAttributes[typeName]);
        if (schemaName && schemaName !== options.serviceName)
          this._edmAttributes[typeName] = this._edmAttributes[typeName].replace(`${ options.serviceName }.`, '');
      }

      // store undecorated type for JSON
      this._type = this._edmAttributes[typeName];
      // decorate for XML (not for Complex/EntityType)
      if (this.$isCollection && this._edmAttributes[typeName])
        this._edmAttributes[typeName] = `Collection(${ this._edmAttributes[typeName] })`;
    }

    toJSONattributes(json) {
      // $Type Edm.String, $Nullable=false MAY be omitted
      // @ property and parameter for performance reasons
      if (this._type !== 'Edm.String' && this._type)   // Edm.String is default)
        json[`$${ this._typeName }`] = this._type;

      if (this._edmAttributes) {
        Object.entries(this._edmAttributes).forEach(([ p, v ]) => {
          if (p !== 'Name' && p !== this._typeName &&
          // remove this line if Nullable=true becomes default
          !(p === 'Nullable' && !v))
            json[p[0] === '@' ? p : `$${ p }`] = v;
        });
      }

      if (this.$isCollection)
        json.$Collection = this.$isCollection;

      return this.toOpenApiHints(json);
    }
  }

  class ComplexType extends TypeBase {
    constructor(version, details, csn) {
      super(version, details, csn);
      if (this.v4 && !!csn['@open'])
        this._edmAttributes.OpenType = true;
    }
  }

  class EntityType extends ComplexType {
    constructor(version, details, properties, csn) {
      super(version, details, csn);
      this.append(...properties);
      const aliasXref = Object.create(null);

      csn.$edmKeyPaths.forEach((p) => {
        const [ alias, ...tail ] = p[0].split('/').reverse();

        if (aliasXref[alias] === undefined)
          aliasXref[alias] = 0;
        else
          aliasXref[alias]++;
        // if it's a path, push the alias
        if (tail.length > 0)
          p.push(alias);
      });
      csn.$edmKeyPaths.slice().reverse().forEach((p) => {
        let alias = p[1];
        if (alias) {
          const c = aliasXref[alias]--;
          // Limit Key length to 32 characters
          if (c > 0) {
            if (alias.length > 28)
              alias = `${ alias.substr(0, 13) }__${ alias.substr(alias.length - 13, alias.length) }`;

            alias = `${ alias }_${ c.toString().padStart(3, '0') }`;
          }
          else if (alias.length > 32) {
            alias = `${ alias.substr(0, 15) }__${ alias.substr(alias.length - 15, alias.length) }`;
          }
          p[1] = alias;
        }
      });

      if (csn.$edmKeyPaths && csn.$edmKeyPaths.length)
        this._keys = new Key(version, csn.$edmKeyPaths);
      else
        this._keys = undefined;

      if (this._openApiHints) {
        if (csn['@cds.autoexpose'])
          this._openApiHints['@cds.autoexpose'] = true;
        if (csn['@cds.autoexposed'])
          this._openApiHints['@cds.autoexposed'] = true;
      }
    }

    innerXML(indent) {
      let xml = '';
      if (this._keys)
        xml += `${ this._keys.toXML(indent) }\n`;
      return xml + super.innerXML(indent);
    }

    toJSONattributes(json) {
      super.toJSONattributes(json);
      if (this._jsonOnlyAttributes) {
        Object.entries(this._jsonOnlyAttributes).forEach(([ p, v ]) => {
          json[p[0] === '@' ? p : `$${ p }`] = v;
        });
      }
      if (this._keys)
        json.$Key = this._keys.toJSON();

      return json;
    }
  }

  class Term extends TypeBase {
    constructor(version, attributes, csn) {
      super(version, attributes, csn);
      const appliesTo = csn['@odata.term.AppliesTo'];
      if (appliesTo)
        this.setEdmAttribute('AppliesTo', Array.isArray(appliesTo) ? appliesTo.join(' ') : appliesTo);
    }
  }

  class TypeDefinition extends TypeBase {
    constructor(version, attributes, csn) {
      super(version, attributes, csn, 'UnderlyingType');
    }

    toJSONattributes(json) {
      super.toJSONattributes(json);
      json.$UnderlyingType = this._type;
      return json;
    }
  }

  class Member extends Node {
    toJSONattributes(json) {
      json[this._edmAttributes.Name] = this._edmAttributes.Value;
      return super.toOpenApiHints(json);
    }
  }

  class EnumType extends TypeDefinition {
    constructor(version, attributes, csn) {
      super(version, attributes, csn);

      // array of enum not yet allowed
      const enumValues = /* (csn.items && csn.items.enum) || */ csn.enum;
      if (enumValues) {
        Object.entries(enumValues).forEach(([ en, e ]) => {
          this.append(new Member(version, { Name: en, Value: e.val } ));
        });
      }
    }

    toJSONchildren(json) {
      this._children.forEach(c => c.toJSONattributes(json));
      return json;
    }
  }

  class PropertyBase extends TypeBase {
    constructor(version, attributes, csn) {
      super(version, attributes, csn);
      this._csn = csn;
      if (this.v2) {
        const typecsn = csn.items || csn;

        // see edmUtils.mapsCdsToEdmType => add sap:display-format annotation
        // only if Edm.DateTime is the result of a cast from Edm.Date
        // but not if Edm.DateTime is the result of a regular cds type mapping
        if (this._edmAttributes.Type === 'Edm.DateTime' &&
        (typecsn.type !== 'cds.DateTime' && typecsn.type !== 'cds.Timestamp'))
          this.setXml( { 'sap:display-format': 'Date' } );
      }
      this.setNullable();
    }

    setNullable() {
      // From the Spec: In OData 4.01 responses a collection-valued property MUST specify a value for the Nullable attribute.
      if (this.$isCollection)
        this._edmAttributes.Nullable = !this.isNotNullable();

      // Nullable=true is default, mention Nullable=false only in XML
      // Nullable=false is default for EDM JSON representation 4.01
      // When a key explicitly (!) has 'notNull = false', it stays nullable
      else if (this.isNotNullable())
        this._edmAttributes.Nullable = false;
    }

    isNotNullable(csn = undefined) {
      const nodeCsn = csn || this._csn;
      // Nullable=true is default, mention Nullable=false only in XML
      // Nullable=false is default for EDM JSON representation 4.01
      // When a key explicitly (!) has 'notNull = false', it stays nullable
      return (nodeCsn._NotNullCollection !== undefined ? nodeCsn._NotNullCollection
        : (nodeCsn.key && nodeCsn.notNull !== false) || nodeCsn.notNull === true);
    }

    toJSONattributes(json) {
      super.toJSONattributes(json);
      // mention all nullable elements explicitly, remove if Nullable=true becomes default
      if (this._edmAttributes.Nullable === undefined || this._edmAttributes.Nullable === true)
        json.$Nullable = true;

      return json;
    }
  }

  /* ReturnType is only used in v4, mapCdsToEdmType can be safely
  called with V2=false */
  class ReturnType extends PropertyBase {
    constructor(version, csn) {
      super(version, {}, csn);
      // CSDL 12.8: If the return type is a collection of entity types,
      // the Nullable attribute has no meaning and MUST NOT be specified.
      if (csn.$NoNullableProperty)
        delete this._edmAttributes.Nullable;
    }

    // we need Name but NO $kind, can't use standard to JSON()
    toJSON() {
      const json = Object.create(null);
      this.toJSONattributes(json);
      // CSDL 12.8: If the return type is a collection of entity types,
      // the Nullable attribute has no meaning and MUST NOT be specified.
      if (this._csn.$NoNullableProperty)
        delete json.$Nullable;
      return json;
    }
  }

  class Property extends PropertyBase {
    constructor(version, attributes, csn) {
      super(version, attributes, csn);
      // TIPHANACDS-4180
      if (this.v2) {
        if (csn['@odata.etag'] || csn['@cds.etag'])
          this._edmAttributes.ConcurrencyMode = 'Fixed';

        // translate the following @sap annos as xml attributes to the Property
        forEach(csn, (p, v) => {
          if (p in Property.SAP_Annotation_Attributes)
            this.setXml( { [`sap:${ p.slice(5).replace(/\./g, '-') }`]: v });
        });
      }

      // OData only allows simple values, no complex expressions or function calls
      // This is a poor man's expr renderer, assuming that edmPreprocessor has
      // added a @Core.ComputedDefaultValue for complex defaults
      if (csn.default && !csn['@Core.ComputedDefaultValue']) {
        const def = csn.default;
        // if def has a value, it's a simple value
        let defVal = def.val;
        // if it's a simple value with signs, produce a string representation
        if (csn.default.xpr) {
          defVal = csn.default.xpr.map((i) => {
            if (i.val !== undefined) {
              if (csn.type === 'cds.Boolean')
                return i.val ? 'true' : 'false';
              return i.val;
            }
            return i;
          }).join('');
        }
        // complex values should be marked with @Core.ComputedDefaultValue already in the edmPreprocessor
        if (this.v4 && defVal !== undefined) {
          /* No Default Value rendering in V2 (or only with future flag).
            Reason: Fiori UI5 expects 'Default' under extension namespace 'sap:'
            Additionally: The attribute is named 'Default' in V2 and 'DefaultValue' in V4
          */
          this._edmAttributes[`Default${ this.v4 ? 'Value' : '' }`] = defVal;
        }
      }
    }

    // required for walker to identify property handling....
    // static get isProperty() { return true }
  }

  // the annotations in this array shall become exposed as Property attributes in
  // the V2 metadata.xml
  Property.SAP_Annotation_Attributes = {
    '@sap.hierarchy.node.for': 1,                  // ->   sap:hierarchy-node-for
    '@sap.hierarchy.parent.node.for': 1,           // ->   sap:hierarchy-parent-node-for
    '@sap.hierarchy.level.for': 1,                 // ->   sap:hierarchy-level-for
    '@sap.hierarchy.drill.state.for': 1,           // ->   sap:hierarchy-drill-state-for
    '@sap.hierarchy.node.descendant.count.for': 1, // ->   sap:hierarchy-node-descendant-count-for
    '@sap.parameter': 1,
  };

  class Parameter extends PropertyBase {
    constructor(version, attributes, csn = {}, mode = null) {
      super(version, attributes, csn);

      if (mode != null)
        this._edmAttributes.Mode = mode;

      // V2 XML: Parameters that are not explicitly marked as Nullable or NotNullable in the CSN must become Nullable=true
      // V2 XML Spec does only mention default Nullable=true for Properties not for Parameters so omitting Nullable=true let
      // the client assume that Nullable is false.... Correct Nullable Handling is done inside Parameter constructor
      if (this.v2 && this._edmAttributes.Nullable === undefined)
        this.setXml({ Nullable: true });
    }

    toJSON() {
      // we need Name but NO $kind, can't use standard to JSON()
      const json = Object.create(null);
      json.$Name = this._edmAttributes.Name;
      return this.toJSONattributes(json);
    }
  }

  class NavigationPropertyBinding extends Node {}

  class OnDelete extends Node {}

  class ReferentialConstraint extends Node {
    constructor(version, attributes, csn) {
      super(version, attributes, csn);
      this._d = null;
      this._p = null;
    }

    innerXML(indent) {
      if (this._d && this._p)
        return `${ this._p.toXML(indent) }\n${ this._d.toXML(indent) }\n`;

      return super.innerXML(indent);
    }
  }

  class NavigationProperty extends Property {
    constructor(version, attributes, csn) {
      super(version, attributes, csn);

      const [ src, tgt ] = edmUtils.determineMultiplicity(csn._constraints._partnerCsn || csn);
      csn._constraints._multiplicity = csn._constraints._partnerCsn ? [ tgt, src ] : [ src, tgt ];
      this._type = attributes.Type;
      this.$isCollection = this.isToMany();
      this._targetCsn = csn._target;

      if (this.v4) {
        if (options.isStructFormat && this._csn.key)
          this._edmAttributes.Nullable = false;

        // either csn has multiplicity or we have to use the multiplicity of the backlink
        if (this.$isCollection) {
          this._edmAttributes.Type = `Collection(${ attributes.Type })`;
          // attribute Nullable is not allowed in combination with Collection (see Spec)
          // Even if min cardinality is > 0, remove Nullable, because the implicit OData contract
          // is that a navigation property must either return an empty collection or all collection
          // values are !null (with other words: a collection must never return [1,2,null,3])
          delete this._edmAttributes.Nullable;
        }
        // we have exactly one selfReference or the default partner
        const partner
          = !csn.$noPartner
            ? csn._selfReferences.length === 1
              ? csn._selfReferences[0]
              : csn._constraints._partnerCsn
            : undefined;
        if (partner && partner['@odata.navigable'] !== false && this._csn._edmParentCsn.kind !== 'type') {
          // $abspath[0] is main entity
          this._edmAttributes.Partner = partner.$abspath.slice(1).join('/');
        }

        /*
          1) If this navigation property belongs to an EntityType for a parameterized entity
          ```entity implemented in calcview (P1: T1, ..., Pn: Tn) { ... }```
          and if the csn.containsTarget for this NavigationProperty is true,
          then this is the generated 'Results' association to the underlying entityType.
          Only this special association may have an explicit ContainsTarget attribute.
          See csn2edm.createEntityTypeAndSet() for details
          2) ContainsTarget stems from the @odata.contained annotation
        */
        if (csn['@odata.contained'] || csn.containsTarget)
          this._edmAttributes.ContainsTarget = true;

        if (this._edmAttributes.ContainsTarget === undefined && csn.type === 'cds.Composition') {
          // Delete is redundant in containment
          // TODO: to be specified via @sap.on.delete
          this.append(new OnDelete(version, { Action: 'Cascade' } ) );
        }
      }

      if (this.v2 && this.isNotNullable()) {
        // in V2 not null must be expressed with target cardinality of 1 or more,
        // store Nullable=false and evaluate in determineMultiplicity()
        delete this._edmAttributes.Nullable;
      }
      // A nav prop has no default value
      delete this._edmAttributes.DefaultValue;

      // store NavProp reference in the model for bidirectional $Partner tagging (done in getReferentialConstraints())
      csn._NavigationProperty = this;
    }

    // if the backlink association is annotated with @odata.contained or the underlying association
    // is marked with _isToContainer, then the association is a Containment relationship
    isContainment() {
      return this._csn._isToContainer || this._csn['@odata.contained'];
    }

    isNotNullable(csn = undefined) {
      const nodeCsn = csn || this._csn;
      // Set Nullable=false only if 'NOT NULL' was specified in the model
      // Do not derive Nullable=false from key attribute.
      // OR if an association has cardinality.min > 0
      // If this is a backlink ($self = <from>.<to>) _partnerCsn.cardinality.srcmin > 0 if available
      // notNull is evaluated for non assoc elements only!
      // A managed association with unspecified cardinality that is to not null
      // is effectively a to-min-1 relationship as there must be a value for
      // the foreign keys (they are not null as well).
      // During the foreign key generation the minimum cardinality of such an association
      // is set to 1 as this property is available in the OData CSN.
      const tgtCard = edmUtils.getEffectiveTargetCardinality(nodeCsn);
      return (nodeCsn.notNull === true && !nodeCsn.target || tgtCard.min > 0);
    }
    isToMany() {
      return (this.$isCollection || this._csn._constraints._multiplicity[1] === '*');
    }

    toJSONattributes(json) {
      // use the original type, not the decorated one
      super.toJSONattributes(json);
      json.$Type = this._type;

      // attribute Nullable is not allowed in combination with Collection (see Spec)
      if (json.$Collection)
        delete json.$Nullable;
      return json;
    }

    toJSONchildren(json) {
      const jsonConstraints = Object.create(null);
      this._children.forEach((c) => {
        switch (c.kind) {
          case 'ReferentialConstraint':
            // collect ref constraints in dictionary
            jsonConstraints[c._edmAttributes.Property] = c._edmAttributes.ReferencedProperty;
            break;
          case 'OnDelete':
            json.$OnDelete = c._edmAttributes.Action;
            break;
          default:
            error(null, `Debug me: Unhandled NavProp child: ${ c.kind }`);
        }
      });
      // TODO Annotations
      if (Object.keys(jsonConstraints).length > 0)
        json.$ReferentialConstraint = jsonConstraints;
      return json;
    }

    // V4 referential constraints!
    addReferentialConstraintNodes() {
      // flip the constrains if this is a $self partner
      let { _constraints } = this._csn;
      let [ i, j ] = [ 0, 1 ];
      if (this._csn._constraints._partnerCsn) {
        _constraints = this._csn._constraints._partnerCsn._constraints;
        [ i, j ] = [ 1, 0 ];
      }
      if (_constraints.constraints) {
        Object.values(_constraints.constraints)
          .forEach(c => this.append(
            new ReferentialConstraint(this._v,
                                      {
                                        Property: c[i].join(options.pathDelimiter),
                                        ReferencedProperty: c[j].join(options.pathDelimiter),
                                      } )
          ));
      }
    }
  }

  // Annotations below
  class AnnotationBase extends Node {
    // No Kind: AnnotationBase is base class for Thing and ValueThing with dynamic kinds,
    // this requires an explicit constructor as the kinds cannot be blacklisted in
    // Node.toJSON()
    toJSON() {
      const json = Object.create(null);
      this.toJSONattributes(json);
      return this.toJSONchildren(json);
    }

    toJSONattributes(json) {
      return super.toJSONattributes(json, false);
    }

    getConstantExpressionValue() {
      // short form: key: value
      const inlineConstExpr
        = [ 'Edm.Binary', 'Edm.Boolean', 'Edm.Byte', 'Edm.Date', 'Edm.DateTimeOffset', 'Edm.Decimal', 'Edm.Double', 'Edm.Duration', 'Edm.Guid',
          'Edm.Int16', 'Edm.Int32', 'Edm.Int64', 'Edm.SByte', 'Edm.Single', 'Edm.Stream', 'Edm.String', 'Edm.TimeOfDay',
          // Edm.Geo* according to https://issues.oasis-open.org/browse/ODATA-1323
          /*          'Edm.Geography', 'Edm.GeographyPoint', 'Edm.GeographyLineString', 'Edm.GeographyPolygon', 'Edm.GeographyMultiPoint',
          'Edm.GeographyMultiLineString', 'Edm.GeographyMultiPolygon', 'Edm.GeographyCollection', 'Edm.Geometry', 'Edm.GeometryPoint',
          'Edm.GeometryLineString', 'Edm.GeometryPolygon', 'Edm.GeometryMultiPoint', 'Edm.GeometryMultiLineString', 'Edm.GeometryMultiPolygon',
          'Edm.GeometryCollection',
*/
          /* UI.xml: defines Annotations with generic type 'Edm.PrimitiveType' */
          'Edm.PrimitiveType', 'Edm.Untyped', 'Bool',
          // Official JSON V4.01 Spec defines these paths as constant inline expression:
          'AnnotationPath', 'ModelElementPath', 'NavigationPropertyPath', 'PropertyPath' ];

      const dict = this._jsonOnlyAttributes;
      const inline = edmUtils.intersect(Object.keys(dict), inlineConstExpr);
      if (inline.length === 1) {
        const v = dict[inline[0]];
        /* short notation for Edm.Boolean, Edm.String and Edm.Float, see internal project:
           edmx2csn-npm/edm-converters/blob/835d92a1aa6b0be25c56cef85e260c9188187429/lib/edmxV40ToJsonV40/README.md
        */
        if (inline[0] === 'Edm.Boolean')
          return (v === 'true' ? true : (v === 'false' ? false : v));
        return v;
      }

      // if this is not a constant expression shortcut, render key/value pair verbatim
      // without filtering non-spec-compliant constExpr
      const json = Object.create(null);
      Object.entries(dict).forEach(([ k, v ]) => {
        json[`$${ k }`] = v;
      });
      return json;
    }

    mergeJSONAnnotations(prefix = '') {
      return this._children.filter(c => c.kind === 'Annotation').reduce((o, a) => {
        Object.entries(a.toJSON()).forEach(([ n, v ]) => {
          o[prefix + n] = v;
        });
        return o;
      },
                                                                        Object.create(null));
    }
  }

  class Annotations extends AnnotationBase {
    constructor(version, target) {
      super(version, { Target: target });
      if (this.v2)
        this._xmlOnlyAttributes.xmlns = 'http://docs.oasis-open.org/odata/ns/edm';
    }

    toJSONattributes(json) {
      forEach(this._edmAttributes, (p, v) => {
        if (p !== 'Target')
          json[p[0] === '@' ? p : `$${ p }`] = v;
      });
      return json;
    }

    toJSONchildren(json) {
      this._children.forEach((a) => {
        Object.entries(a.toJSON()).forEach(([ n, v ]) => {
          json[n] = v;
        });
      });
      return json;
    }
  }

  // An Annotation must contain either children or a constant value
  // The value attribute is rendered by getConstantExpressionValue().
  // However, in case the constant expression value differs for XML an JSON
  // (EnumMember & EnumMember@odata.type) then the value properties must
  // be separated by using setJSON(attribute) and setXML(attribute).
  // See genericTranslation::handleValue() for details (especially the code
  // that sets the EnumMember code). All this has been done because the
  // Annotation object is passed around in genericTranslation and the
  // properties are set all over the place. The initial assumption was that
  // the constant expression value is the same for both XML and JSON. But
  // since it was discovered, that in JSON the EnumMember type must be
  // transported this is no longer the case....
  class Annotation extends AnnotationBase {
    constructor(version, termName, ...children) {
      super(version, { Term: termName } );
      this.append(...children);
    }

    toJSON() {
      const json = super.mergeJSONAnnotations(this.getJsonFQTermName());
      const e = this._children.filter(c => c.kind !== 'Annotation');
      if (e.length === 0 || this._ignoreChildren) // must be a constant expression
        json[this.getJsonFQTermName()] = this.getConstantExpressionValue();
      else
        // annotation must have exactly one child (=record or collection)
        json[this.getJsonFQTermName()] = e[0].toJSON();
      return json;
    }

    getJsonFQTermName() {
      return `@${ this._edmAttributes.Term }${ this._edmAttributes.Qualifier ? `#${ this._edmAttributes.Qualifier }` : '' }`;
    }
  }

  class Collection extends AnnotationBase {
    constructor(version, ...children) {
      super(version);
      this.append(...children);
    }

    toJSON() {
      // EDM JSON doesn't mention annotations on collections
      return this._children.map(a => a.toJSON());
    }
  }

  class Record extends AnnotationBase {
    constructor(version, ...children) {
      super(version);
      this.append(...children);
    }
    toJSONattributes(json) {
      if (this._jsonOnlyAttributes.Type)
        json['@type'] = this._jsonOnlyAttributes.Type;
      const keys = Object.keys(this._edmAttributes).filter(k => k !== 'Type');
      for (const key of keys)
        json[`$${ key }`] = this._edmAttributes[key];
      return json;
    }

    toJSONchildren(json) {
      this._children.forEach((c) => {
        switch (c.kind) {
          case 'Annotation': {
            Object.entries(c.toJSON()).forEach(([ n, v ]) => {
              json[n] = v;
            });
            break;
          }
          case 'PropertyValue': {
            // plus property annotations as [a.Property]@anno: val
            Object.entries(c.mergeJSONannotations()).forEach(([ n, a ]) => {
              json[n] = a;
            });
            // render property as const expr (or subnode)
            json[c._edmAttributes.Property] = c.toJSON();
            break;
          }
          default:
            error(null, `Pease debug me: Unhandled Record child: ${ c.kind }`);
        }
      });
      return json;
    }
  }

  class PropertyValue extends AnnotationBase {
    constructor(version, property) {
      super(version);
      this._edmAttributes.Property = property;
    }

    toJSON() {
      const children = this._children.filter(child => child.kind !== 'Annotation');
      if (children.length === 0 || this._ignoreChildren)
        return this.getConstantExpressionValue();

      return children[0].toJSON();
    }
    mergeJSONannotations() {
      return super.mergeJSONAnnotations(this._edmAttributes.Property);
    }
  }

  class Thing extends AnnotationBase {
    constructor(version, kind, details) {
      super(version, details);
      this._kind = kind;
    }

    get kind() {
      return this._kind;
    }
  }

  class ValueThing extends Thing {
    constructor(version, kind, value) {
      super(version, kind, undefined);
      this._value = value;
    }

    toXML(indent = '') {
      const { kind } = this;
      let xml = `${ indent }<${ kind }${ this.toXMLattributes() }`;
      xml += (this._value !== undefined ? `>${ edmUtils.escapeStringForText(this._value) }</${ kind }>` : '/>');
      return xml;
    }

    toJSON() {
      if (this._children.length === 0 || this._ignoreChildren) // must be a constant expression
        return this.getConstantExpressionValue();
      return this._children[0].toJSON();
    }
  }

  // Binary/Unary dynamic expression
  class Expr extends Thing {
    toJSON() {
      // toJSON: depending on number of children unary or n-ary expr
      const json = this.mergeJSONAnnotations();
      const e = this._children.filter(c => c.kind !== 'Annotation');
      if (e.length === 1)
        json[`$${ this.kind }`] = e[0].toJSON();

      else
        json[`$${ this.kind }`] = e.map(c => c.toJSON());

      return json;
    }
  }

  class Null extends AnnotationBase {
    toXMLattributes() {
      return '';
    }
    toJSON() {
      const json = this.mergeJSONAnnotations();
      json[`$${ this.kind }`] = null;
      return json;
    }
  }
  class Apply extends AnnotationBase {
    toJSON() {
      const json = this.mergeJSONAnnotations();
      json[`$${ this.kind }`] = this._children.filter(c => c.kind !== 'Annotation').map(c => c.toJSON());
      return this.toJSONattributes(json);
    }
  }
  class Cast extends AnnotationBase {
    toXMLattributes() {
      if (this._jsonOnlyAttributes.Collection) {
        const ot = this._edmAttributes.Type;
        this._edmAttributes.Type = `Collection(${ ot })`;
        const str = super.toXMLattributes();
        this._edmAttributes.Type = ot;
        return str;
      }
      return super.toXMLattributes();
    }
    toJSON() {
      const json = this.mergeJSONAnnotations();
      // first expression only, if any
      const children = this._children.filter(child => child.kind !== 'Annotation');
      json[`$${ this.kind }`] = children.length ? children[0].toJSON() : {};
      return this.toJSONattributes(json);
    }
    toJSONattributes(json) {
      super.toJSONattributes(json);
      if (this._jsonOnlyAttributes) {
        Object.entries(this._jsonOnlyAttributes).forEach(([ p, v ]) => {
          json[p[0] === '@' ? p : `$${ p }`] = v;
        });
      }
      return json;
    }
  }
  class IsOf extends Cast {}

  class If extends AnnotationBase {
    toJSON() {
      const json = this.mergeJSONAnnotations();
      json[`$${ this.kind }`] = this._children.filter(c => c.kind !== 'Annotation').map(c => c.toJSON());
      return json;
    }
  }
  class LabeledElement extends AnnotationBase {
    toJSON() {
      const json = this.mergeJSONAnnotations();
      // first expression only, if any
      const children = this._children.filter(child => child.kind !== 'Annotation');
      json[`$${ this.kind }`] = children.length ? children[0].toJSON() : '';
      return this.toJSONattributes(json);
    }

    toJSONattributes(json) { // including Name
      forEach(this._edmAttributes, (p, v) => {
        json[p[0] === '@' ? p : `$${ p }`] = v;
      });
      return json;
    }
  }
  // LabeledElementReference is a
  class LabeledElementReference extends ValueThing {
    constructor(version, val) {
      super(version, 'LabeledElementReference', val);
    }
  }
  class UrlRef extends AnnotationBase {
    toJSON() {
      const json = this.mergeJSONAnnotations();
      // first expression only, if any
      const children = this._children.filter(child => child.kind !== 'Annotation');
      json[`$${ this.kind }`] = children.length ? children[0].toJSON() : {};
      return json;
    }
  }

  // V2 specials
  class End extends Node {}
  class Association extends Node {
    constructor(version, details, navProp, fromRole, toRole, multiplicity) {
      super(version, details);
      this._end = [
        new End(version, { Role: fromRole[0], Type: fromRole[1], Multiplicity: multiplicity[0] } ),
        new End(version, { Role: toRole[0], Type: toRole[1], Multiplicity: multiplicity[1] } ),
      ];

      // set Delete:Cascade on composition end
      if (navProp._csn.type === 'cds.Composition')
        this._end[0].append(new OnDelete(version, { Action: 'Cascade' }));

      if (navProp._csn._selfReferences && navProp._csn._selfReferences.length &&
         navProp._csn._selfReferences[0].type === 'cds.Composition')
        this._end[1].append(new OnDelete(version, { Action: 'Cascade' }));
    }

    innerXML(indent) {
      let xml = '';
      this._end.forEach((e) => {
        xml += `${ e.toXML(indent) }\n`;
      });
      xml += super.innerXML(indent);
      return xml;
    }
  }

  class AssociationSet extends Node {
    constructor(version, details, fromRole, toRole, fromEntitySet, toEntitySet) {
      super(version, details);
      this.append(
        new End(version, { Role: fromRole, EntitySet: fromEntitySet } ),
        new End(version, { Role: toRole, EntitySet: toEntitySet } )
      );
    }
    getDuplicateMessage() {
      return `Association "${ this._edmAttributes.Association }"`;
    }
  }

  class Dependent extends Node {}
  class Principal extends Node {}

  ReferentialConstraint.createV2
    = (v, from, to, c) => {
      const node = new ReferentialConstraint(v, {});
      node._d = new Dependent(v, { Role: from } );
      node._p = new Principal(v, { Role: to } );

      if (c) {
        Object.values(c).forEach((cv) => {
          node._d.append(new PropertyRef(v, cv[0].join(options.pathDelimiter)));
          node._p.append(new PropertyRef(v, cv[1].join(options.pathDelimiter)));
        });
      }
      return node;
    };

  return {
    Edm,
    Reference,
    Include,
    Schema,
    DataServices,
    EntityContainer,
    EntitySet,
    Singleton,
    TypeBase,
    Term,
    TypeDefinition,
    EnumType,
    ComplexType,
    EntityType,
    Key,
    // ActionFunctionBase,
    FunctionDefinition,
    Action,
    FunctionImport,
    ActionImport,
    ReturnType,
    // PropertyBase,
    Property,
    PropertyRef,
    Parameter,
    NavigationPropertyBinding,
    NavigationProperty,
    ReferentialConstraint,
    OnDelete,
    // Annotations
    Annotations,
    Annotation,
    Collection,
    Record,
    Thing,
    ValueThing,
    PropertyValue,
    // Expressions
    Expr,
    Null,
    Apply,
    Cast,
    If,
    IsOf,
    LabeledElement,
    LabeledElementReference,
    UrlRef,
    // V2 specials
    End,
    Association,
    AssociationSet,
    Dependent,
    Principal,
  };
} // instance function

module.exports = {
  getEdm,
};
