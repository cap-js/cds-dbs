// Grammar for CDS

parser grammar Cdl;
options {
  language = JavaScript;
  superClass = AstBuildingParser;
}
@header{
  const { XsnSource, XsnArtifact, XsnName } = require( '../compiler/xsn-model' );
  const AstBuildingParser = require('../parsers/AstBuildingParser');
}
@footer{
  module.exports = { CdlParser }; // make it work with lazyload()
}

// Content:
//  - top-level: USING, NAMESPACE, artifactDefOrExtend (start rule: start)
//  - main definitions and annotation def
//  - member definitions
//  - EXTEND and ANNOTATE
//  - type expressions
//  - queries: the main query hierarchy (start rule: queryEOF)
//  - queries: columns and other clauses
//  - conditions and expressions (start rule: conditionEOF)
//  - paths and functions
//  - annotation assignments

tokens{                         // reserved words
  ALL, ANY, AS,
  BY,
  CASE, CAST,
  DISTINCT,                     // not entirely necessary
  EXISTS,
  FALSE, FROM,
  IN,
  KEY,
  NOT, NULL,
  OF, ON,
  SELECT, SOME,
  TRUE,
  WHEN, WHERE, WITH,
}

// Top-level: USING, NAMESPACE, artifactDefOrExtend (start rule: start) ---------

start returns[ source = new XsnSource( 'cdl' ) ]
  :
    { this.afterBrace( null, 'init' ); }<always> // init sloppy semicolon handling
    (
      ( <guard=namespaceRestriction> namespaceDeclaration[ $source ]
      | usingDeclaration[ $source ]
      | artifactDefOrExtend[ $source ] <prepare=namespaceRestriction>
      )
      ( ';' | <exitLoop> | <repeatLoop, guard=afterBrace> { this.noAssignmentInSameLine(); } )
    )*
    EOF { this.docComment( null ); }
  ;

artifactsBlock[ art, start = undefined ]
  :
    '{' <prepare=afterBrace, arg=init>
    { $art.artifacts = this.createDict( $start ); $art.extensions = []; }
    (
      artifactDefOrExtend[ $art ]
      ( ';' | <exitLoop> | <repeatLoop, guard=afterBrace> { this.noAssignmentInSameLine(); } )
    )*
    '}'<prepare=afterBrace>
    { this.finalizeDictOrArray( $art.artifacts ); }
  ;

artifactDefOrExtend[ outer ] locals[ art = new XsnArtifact() ]
  :
    { $art.location = this.startLocation(); }
    { this.docComment( $art ); } annoAssignStd[ $art ]*
    (
      DEFINE?
      ( serviceDef[ $art, $outer ]
      | contextDef[ $art, $outer ]
      | <guard=vocabularyRestriction> annotationDef[ $art, $outer ]
      | typeDef[ $art, $outer ]
      | aspectDef[ $art, $outer ]
      | entityDef[ $art, $outer ]
      | <hide> viewDef[ $art, $outer ]
      | eventDef[ $art, $outer ]
      | actionMainDef[ $art, $outer ]
      | functionMainDef[ $art, $outer ]
      )
    |
      <guard=extensionRestriction> EXTEND { $art.kind = 'extend'; }
      ( extendArtifact[ $art, $outer ]
      | extendService[ $art, $outer ]
        // Non-streamlined Syntax; we would neither add new clauses to them, nor
        // add more of them (for further `kind`s):
      | <hide> extendContext[ $art, $outer ]
      | <hide> extendType[ $art, $outer ]
      | <hide> extendEntityOrAspect[ $art, $outer ]
      | <hide> extendProjection[ $art, $outer ]
      )
    |
      <guard=extensionRestriction> ANNOTATE annotateArtifact[ $art, $outer ]
    )
  ;

namespaceDeclaration[ source ]
@finally{ this.attachLocation( $source.namespace ); }
  :
    NAMESPACE name=namePath[ 'Namespace' ]
    { $source.namespace ??= { kind: 'namespace', name: $name }; }
    // TODO: XsnArtifact ?
  ;

usingDeclaration[ source ] locals[ decl = { kind: 'using' } ] // TODO: XsnArtifact ?
@finally{ this.attachLocation( $decl ); }
  :
    USING
    (
      FROM String
       { $source.dependencies.push( this.quotedLiteral() ); }
    |
      usingProxy[ $source, $decl ]
      ( FROM String
        { $source.dependencies.push( $decl.fileDep = this.quotedLiteral() ); }
      )?
    |
      { $source.usings.push( $decl ); }
      // We could just create "independent" USING declaration, but if we want
      // to have some check in the future whether the external artifacts are
      // really in the FROM source...
      '{' { $decl.usings = this.createArray(); }
      ( usingProxy[ $decl, { kind: 'using' } ]
        ( ',' | <exitLoop> )
      )*
      '}'<prepare=afterBrace>
      { this.finalizeDictOrArray( $decl.usings ); }
      ( FROM String
        { $source.dependencies.push( $decl.fileDep = this.quotedLiteral() ); }
      )?
    )
  ;

usingProxy[ outer, proxy ]
@finally{ this.attachLocation( $proxy ); }
  :
    extern=simplePath[ 'global' ]
    { $proxy.extern = $extern; $outer.usings.push( $proxy ); }
    ( AS Id['UsingAlias'] { $proxy.name = this.identAst(); } // TODO: XsnName ?
    | { this.classifyImplicitName( 'Using' ); }
    )
  ;

namePath[ category ] returns[ default name = new XsnName() ]
@finally{ this.attachLocation( $name ); }
  :
    Id[ $category ] { $name.path = [ this.identAst() ]; }
    (
      '.' Id_all[ $category ] { $name.path.push( this.identAst() ); }
    )*
  ;

simplePath[ category = 'artref' ] returns[ default ref = {} ]
@finally{ this.attachLocation( $ref ); }
  :
    Id[ $category ]
    { $ref.path = [ this.identAst() ]; }
    (
      '.' Id_all[ $category ] { $ref.path.push( this.identAst() ); }
    )*
  ;

// Annotation def and main definitions ------------------------------------------

serviceDef[ art, outer ]
@finally{ this.attachLocation( $art ); }
  :
    SERVICE <prepare=vocabularyRestriction>
    name=namePath[ 'Service' ]
    { this.addDef( $art, $outer, 'artifacts', 'service', $name ); }
    { this.docComment( $art ); } annoAssignMid[ $art ]*
    artifactsBlock[ $art ]?
  ;

contextDef[ art, outer ]
@finally{ this.attachLocation( $art ); }
  :
    CONTEXT <prepare=vocabularyRestriction>
    name=namePath[ 'Context' ]
    { this.addDef( $art, $outer, 'artifacts', 'context', $name ); }
    { this.docComment( $art ); } annoAssignMid[ $art ]*
    artifactsBlock[ $art ]?
  ;

annotationDef[ art, outer ]
@finally{ this.attachLocation( $art ); }
  :
    ANNOTATION name=namePath[ 'AnnoDef' ]
    // make it also work with ignored <guard=vocabularyRestriction>:
    { this.addDef( $art, $outer, ($outer.kind === 'source' ? 'vocabularies' : 'artifacts'), 'annotation', $name ); }
    { this.docComment( $art ); } annoAssignMid[ $art ]*
    typeOrIncludesSpec[ $art ]
  ;

typeDef[ art, outer ]
@finally{ this.attachLocation( $art ); }
  :
    TYPE name=namePath[ 'Type' ]
    { this.addDef( $art, $outer, 'artifacts', 'type', $name ); }
    { this.docComment( $art ); } annoAssignMid[ $art ]*
    typeOrIncludesSpec[ $art ]  // TODO: optional
  ;

aspectDef[ art, outer ]
@finally{ this.attachLocation( $art ); }
  :
    ( ASPECT
    | <hide> ABSTRACT { this.warning( 'syntax-deprecated-abstract', this.combineLocation( this.lb(), this.la() ) ); }
      ENTITY
    )
    name=namePath[ 'Type' ]     // TODO: Type?
    { this.addDef( $art, $outer, 'artifacts', 'aspect', $name ); }
    { this.docComment( $art ); } annoAssignMid[ $art ]*
    (
      elementsBlock[ $art ]
    |
      <exitRule>
    |
      ':'
      (
        incl=simplePath { $art.includes ??= []; $art.includes.push( $incl ); }
        ( ',' | <exitLoop> | <exitRule> )
      )*
      elementsBlock[ $art ]
    )
    actionsBlock[ $art ]?
  ;

entityDef[ art, outer ]
@finally{ this.attachLocation( $art ); }
  :
    ENTITY
    name=namePath[ 'Entity' ]
    { this.addDef( $art, $outer, 'artifacts', 'entity', $name ); }
    { this.docComment( $art ); } annoAssignMid[ $art ]*
    paramsList[ $art ]?
    (
      ( ':' { $art.includes ??= []; }
        (
          incl=simplePath { $art.includes.push( $incl ); }
          ( ',' | <exitLoop> )
        )+
      )?
      elementsBlock[ $art ]
    |
      AS
      (
        query=queryExpression
        { $art.query = $query; $art.$syntax = 'entity'; }
      |
        <prepare=afterBrace, arg=sloppy> // enable special loop-exit, allow no `;`
        query=projectionSpec
        { $art.query = $query; $art.$syntax = 'projection'; }
        whereGroupByHaving[ $query ]?
        orderByLimitOffset[ $query ]?
        {;}<prepare=afterBrace, arg=normal> // disable special loop-exit, allow no `;`
        // TODO v6: these <prepare=afterBrace>s are extremely strange
      )
    )
    actionsBlock[ $art ]?
  ;

viewDef[ art, outer ]
@finally{ this.attachLocation( $art ); }
  :
    VIEW name=namePath[ 'Entity' ]
    { this.addDef( $art, $outer, 'artifacts', 'entity', $name ); }
    { this.docComment( $art ); } annoAssignMid[ $art ]*
    (
      paramsList[ $art ]
    |
      <hide> WITH PARAMETERS { $art.params = this.createDict(); }
      paramDef[ $art ]
      ( ',' paramDef[ $art ] )* // no optional final ',' here
      { this.finalizeDictOrArray( $art.params ); }
    )?
    AS query=queryExpression
    { $art.query = $query; $art.$syntax = 'view'; }
  ;

eventDef[ art, outer ]
@finally{ this.attachLocation( $art ); }
  :
    EVENT
    name=namePath[ 'Event' ]
    { this.addDef( $art, $outer, 'artifacts', 'event', $name ); }
    { this.docComment( $art ); } annoAssignMid[ $art ]*
    (
      elementsBlock[ $art ]
    |
      ':'
      (
        elementsBlock[ $art ]
      |
        incl=simplePath { $art.type = $incl; }
        (
          { $art.includes = [ $art.type ]; delete $art.type; }
          ( ','
            ( incl=simplePath { $art.includes.push( $incl ); }
              ( ',' | <exitLoop> )
            )*
          )?
          elementsBlock[ $art ]
        |
          { this.docComment( $art ); } annoAssignStd[ $art ]*
        )
      |
        query=projectionSpec { $art.query = $query; $art.$syntax = 'projection'; }
      )
    )
  ;

actionMainDef[ art, outer ]
@finally{ this.attachLocation( $art ); }
  :
    ACTION name=namePath[ 'Action' ]
    { this.addDef( $art, $outer, 'artifacts', 'action', $name ); }
    { this.docComment( $art ); } annoAssignMid[ $art ]*
    paramsList[ $art ]
    returnsSpec[ $art ]?
  ;

functionMainDef[ art, outer ]
@finally{ this.attachLocation( $art ); }
  :
    FUNCTION name=namePath[ 'Action' ]
    { this.addDef( $art, $outer, 'artifacts', 'function', $name ); }
    { this.docComment( $art ); } annoAssignMid[ $art ]*
    paramsList[ $art ]
    returnsSpec[ $art ]
  ;

// Member definitions: actions, parameters, elements, enums: --------------------

actionsBlock[ art ]
  :
    ACTIONS { $art.actions = this.createDict(); } '{'
    (
      boundActionFunctionDef[ $art ]
      ( ';' | <exitLoop> | <repeatLoop, guard=afterBrace> { this.noAssignmentInSameLine(); } )
    )*
    '}'<prepare=afterBrace>
    { this.finalizeDictOrArray( $art.actions ); }
  ;

boundActionFunctionDef[ outer ] locals[ art = new XsnArtifact() ]
@finally{ this.attachLocation( $art ); }
  :
    { this.docComment( $art ); } annoAssignStd[ $art ]*
    (
      ACTION Id['BoundAction']
      { this.addDef( $art, $outer, 'actions', 'action', this.identAst() ); }
      { this.docComment( $art ); } annoAssignMid[ $art ]*
      paramsList[ $art ]
      returnsSpec[ $art ]?
    |
      FUNCTION Id['BoundAction']
      { this.addDef( $art, $outer, 'actions', 'function', this.identAst() ); }
      { this.docComment( $art ); } annoAssignMid[ $art ]*
      paramsList[ $art ]
      returnsSpec[ $art ]
    )
  ;

paramsList[ art ]
  :
    '(' { $art.params = this.createDict(); }
    (
      paramDef[ $art ]
      ( ',' | <exitLoop> )
    )*
    ')' { this.finalizeDictOrArray( $art.params ); }
  ;

paramDef[ outer ] locals[ art = new XsnArtifact() ]
@finally{ this.attachLocation( $art ); }
  :
    { this.docComment( $art ); } annoAssignStd[ $art ]*
    Id_all['Param']
    { this.addDef( $art, $outer, 'params', 'param', this.identAst() ); }
    { this.docComment( $art ); } annoAssignMid[ $art ]*
    (
      elementsBlock[ $art ]
      nullability[ $art ]?
    |
      ':'
      typeExpression[ $art ]    // was elementType, with NOT? NULL / DEFAULT
    )
  ;

returnsSpec[ outer ] locals[ art = new XsnArtifact() ]
@finally{ this.attachLocation( $art ); if ($ret) art.location.tokenIndex = $ret.location.tokenIndex; }
  :
    ret=RETURNS <prepare=elementRestriction, arg=default>
    { $art.kind = 'param'; $outer.returns = $art; }
    { this.docComment( $art ); } annoAssignStd[ $art ]*
    typeExpression[ $art ]
  ;

elementsBlock[ art ]
  :
    '{' { $art.elements = this.createDict(); }
    ( elementDef[ $art ]
      ( ';'
      | <exitLoop>
      | <repeatLoop, guard=afterBrace, restrict=Id> { this.noAssignmentInSameLine(); }
      )
    )*
    '}'<prepare=afterBrace>
    { this.finalizeDictOrArray( $art.elements ); }
  ;

elementDef[ outer, art = undefined ]
@finally{ this.attachLocation( $art ); }
  :
    { $art ??= new XsnArtifact(); }
    { this.docComment( $art ); } annoAssignStd[ $art ]*
    ( VIRTUAL { $art.virtual = this.valueWithLocation( true ); } )?
    ( KEY { $art.key = this.valueWithLocation( true ); } )?
    ( <hide> MASKED { $art.masked = this.valueWithLocation( true ); }
      { this.message( 'syntax-unsupported-masked', this.lb(), { keyword: 'masked' } ); } )?
    ( <hide> ELEMENT { $art.$syntax = 'element'; } )?
    Id['Element'] <prepare=elementRestriction, arg=elem>
    { this.addDef( $art, $outer, 'elements', 'element', this.identAst() ); }
    { this.docComment( $art ); } annoAssignMid[ $art ]*
    (
      elementsBlock[ $art ]
      nullability[ $art ]?
    |
      ':' typeExpression[ $art ] // includes DEFAULT
    )?
    (
      <guard=elementRestriction, arg=calc> '='
      // TODO TOOL: add to "expected set" if failing here?  Or have some "do not
      // consider for rule exit if condition failure on `=`"?
      expr=expression { $art.value = $expr; }
      ( STORED { $art.value.stored = this.valueWithLocation( true ); } )?
      // TODO: why have `stored` as property of the value?
      { if (!this.elementRestriction( true, 'anno' )) this.docComment( $art ); }
      ( <guard=elementRestriction, arg=anno> annoAssignStd[ $art ] )*
    )?
  ;

enumSymbolsBlock[ art ]
  :
    ENUM { $art.enum = this.createDict(); } '{'
    ( enumSymbolDef[ $art ]
      ( ';' | <exitLoop> )
    )*
    '}'<prepare=afterBrace>
    { this.finalizeDictOrArray( $art.enum ); }
  ;

enumSymbolDef[ outer ] locals[ art = new XsnArtifact() ]
@finally{ this.attachLocation( $art ); }
  :
    { this.docComment( $art ); } annoAssignStd[ $art ]*
    Id['Enum']
    { this.addDef( $art, $outer, 'enum', 'enum', this.identAst() ); }
    { this.docComment( $art ); } annoAssignStd[ $art ]*
    ( '='
      (
        <prefer> String
        { $art.value = this.quotedLiteral(); }
      |
        <prefer> Number
        { $art.value = this.numberLiteral(); }
      |
        sign='+'/'-' Number
        { $art.value = this.numberLiteral( $sign ); }
      |
        <hide> value=literalValue
        { $art.value = $value; }
      )
      { this.docComment( $art ); } annoAssignStd[ $art ]*
    )?
  ;

foreignKeysBlock[ art ]
  :
    '{' { $art.foreignKeys = this.createDict(); }
    ( foreignKeyDef[ $art ]
      ( ',' | <exitLoop> )
    )*
    '}'         // DOES NOT SET afterBrace, because we allow annos after { …fks… }
    { this.finalizeDictOrArray( $art.foreignKeys ); }
  ;

foreignKeyDef[ outer ] locals[ art = new XsnArtifact(), name ]
@finally{ this.attachLocation($art); }
  :
    { this.docComment( $art ); } annoAssignStd[ $art ]*
    ref=simplePath[ 'ref' ] { $art.targetElement = $ref; }
    ( AS name=Id['Key'] { $name = this.identAst(); }
    | { this.classifyImplicitName( 'KeyImplicit', $ref ); $name = $ref.path; }
    )
    { this.addDef( $art, $outer, 'foreignKeys', 'key', $name ); }
    // TODO: for a more uniform syntax, we'd allow:
    // { this.docComment( $art ); } annoAssignMid[ $art ]*
  ;

mixinElementDef[ outer ] locals[ art = new XsnArtifact() ]
@finally{ this.attachLocation($art); }
  :
    Id['Mixin']
    { this.addDef( $art, $outer, 'mixin', 'mixin', this.identAst() ); }
    ':'
    ( assoc=ASSOCIATION cardinality[ $art ]? TO
    | assoc=COMPOSITION cardinality[ $art ]? OF
    )
    ( <guard=noRepeatedCardinality> card=ONE/MANY )?
    target=simplePath
    { this.setAssocAndComposition( $art, $assoc, $card, $target ); }
    ON expr=condition { $art.on = $expr; }
  ;

// Annotate and Extend: main definitions ----------------------------------------

annotateArtifact[ art, outer ]
@finally{ this.attachLocation( $art ); }
  :
    name=namePath[ 'Ext' ]
    ( // direct element annotation:
      ':' elemName=namePath[ 'ExtElement']
      { this.addExtension( $art, $outer, 'annotate', $name, $elemName.path ); }
      keyword=WITH?
      { this.docComment( $art ); } annoAssignStd[ $art ]*
      annotateElementsBlock[ $art ]?
    | // definition annotation
      keyword=WITH?
      // <guard=noRuleExitAfterWith>), or as rule option,
      // this.noSemicolonHere() had the issues: DocComment, before `}`/EOF
      { this.addExtension( $art, $outer, 'annotate', $name ); }
      { this.docComment( $art ); } annoAssignStd[ $art ]*
      annotateParamsBlock[ $art ]?
      (
        annotateReturns[ $art ]
      |
        annotateElementsBlock[ $art ]?
        annotateActionsBlock[ $art ]?
      )
    )
    { this.checkWith( $keyword ); }
  ;

extendArtifact[ art, outer ]
@finally{ this.attachLocation( $art ); }
  :
    name=namePath[ 'Ext' ]
    ( // direct element annotation:
      ':' elemName=namePath[ 'ExtElement']
      { this.addExtension( $art, $outer, 'extend', $name, $elemName.path ); }
      keyword=WITH?
      { this.docComment( $art ); } annoAssignStd[ $art ]*
      (
        elements=ELEMENTS? extendElementsBlock[ $art, $elements ]
      |
        enumSymbolsBlock[ $art ] // ENUM …, just define, no extend
      |
        typeNamedArgsList[ $art ]
      )?
    |
      { this.addExtension( $art, $outer, 'extend', $name ); }
      { this.docComment( $art ); } annoAssignStd[ $art ]*
      ( extendElementsBlock[ $art ]
        actionsBlock[ $art ]?
      )?
    |
      keyword=WITH
      { this.addExtension( $art, $outer, 'extend', $name ); }
      { this.docComment( $art ); } annoAssignStd[ $art ]*
      (
        incl=simplePath { $art.includes = [ $incl ]; }
        ( ',' incl=simplePath { $art.includes.push( $incl ); } )*
        extendElementsBlock[ $art ]?
        actionsBlock[ $art ]?
      |
        elements=ELEMENTS? extendElementsBlock[ $art, $elements ]
        actionsBlock[ $art ]?
      |
        actionsBlock[ $art ]
      |
        enumSymbolsBlock[ $art ] // ENUM …, just define, no extend
      |
        typeNamedArgsList[ $art ]
      |
        COLUMNS selectItemsList[ $art, this.lb() ]
      |
        DEFINITIONS artifactsBlock[ $art, this.lb() ]
      )?
    )
    { this.checkWith( $keyword ); }
  ;

extendService[ art, outer ]
@finally{ this.checkWith( $keyword ); this.attachLocation( $art ); }
  :
    SERVICE { $art.expectedKind = this.valueWithLocation(); }
    name=namePath[ 'ExtService' ]
    { $art.name = $name; $outer.extensions.push( $art ); }
    keyword=WITH?
    // <guard=noRuleExitAfterWith>), or as rule option,
    // this.noSemicolonHere() had the issues: DocComment, before `}`/EOF
    { this.docComment( $art ); } annoAssignStd[ $art ]*
    artifactsBlock[ $art ]?
  ;

extendContext[ art, outer ]
@finally{ this.checkWith( $keyword ); this.attachLocation( $art ); }
  :
    CONTEXT { $art.expectedKind = this.valueWithLocation(); }
    name=namePath[ 'ExtContext' ]
    { $art.name = $name; $outer.extensions.push( $art ); }
    keyword=WITH?
    // <guard=noRuleExitAfterWith>), or as rule option,
    // this.noSemicolonHere() had the issues: DocComment, before `}`/EOF
    { this.docComment( $art ); } annoAssignStd[ $art ]*
    artifactsBlock[ $art ]?
  ;

extendType[ art, outer ]
@finally{ this.checkWith( $keyword ); this.attachLocation( $art ); }
  :
    TYPE { $art.expectedKind = this.valueWithLocation(); }
    name=namePath[ 'Ext' ]
    { $art.name = $name; $outer.extensions.push( $art ); }
    (
      { this.docComment( $art ); } annoAssignStd[ $art ]*
      extendElementsBlock[ $art ]?
    |
      keyword=WITH
      { this.docComment( $art ); } annoAssignStd[ $art ]*
      (
        incl=simplePath { $art.includes = [ $incl ]; }
        ( ',' incl=simplePath { $art.includes.push( $incl ); } )*
        extendElementsBlock[ $art ]?
      |
        elements=ELEMENTS? extendElementsBlock[ $art, $elements ]
      |
        enumSymbolsBlock[ $art ]
      |
        typeNamedArgsList[ $art ]
      )?
    )
  ;

extendEntityOrAspect[ art, outer ]
@finally{ this.checkWith( $keyword ); this.attachLocation( $art ); }
  :
    ASPECT/ENTITY { $art.expectedKind = this.valueWithLocation(); }
    name=namePath[ 'Ext' ]
    { $art.name = $name; $outer.extensions.push( $art ); }
    (
      { this.docComment( $art ); } annoAssignStd[ $art ]*
    |
      keyword=WITH
      { this.docComment( $art ); } annoAssignStd[ $art ]*
      (
        incl=simplePath { $art.includes = [ $incl ]; }
        ( ',' incl=simplePath { $art.includes.push( $incl ); } )*
      )?
    )
    extendElementsBlock[ $art ]?
    actionsBlock[ $art ]?
  ;

extendProjection[ art, outer ]
@finally{ this.checkWith( $keyword ); this.attachLocation( $art ); }
  :
    PROJECTION { $art.expectedKind = this.valueWithLocation(); }
    name=namePath[ 'Ext' ]
    { $art.name = $name; $outer.extensions.push( $art ); }
    keyword=WITH ?
    { this.docComment( $art ); } annoAssignStd[ $art ]*
    selectItemsList[ $art ]?
    actionsBlock[ $art ]?
  ;

// Extend and annotate on members: bound actions, parameters, elements ----------

annotateActionsBlock[ art ]
  :
    ACTIONS { $art.actions = this.createDict(); } '{'
    ( annotateBoundAction[ $art ]
      ( ';' | <exitLoop> | <repeatLoop, guard=afterBrace> { this.noAssignmentInSameLine(); } )
    )*
    '}'<prepare=afterBrace>
    { this.finalizeExtensionsDict( $art.actions ); }
  ;

annotateBoundAction[ outer ] locals[ art = new XsnArtifact() ]
@finally{ this.attachLocation( $art ); }
  :
    { this.docComment( $art ); } annoAssignStd[ $art ]*
    Id['ExtBoundAction']
    { this.addDef( $art, $outer, 'actions', 'annotate', this.identAst() ); }
    { this.docComment( $art ); } annoAssignStd[ $art ]*
    annotateParamsBlock[ $art ]?
    annotateReturns[ $art ]?
  ;

annotateParamsBlock[ art ]
  :
    '(' { $art.params = this.createDict(); }
    ( annotateParam[ $art ]
      ( ',' | <exitLoop> )
    )*
    ')'
    { this.finalizeExtensionsDict( $art.params ); }
  ;

annotateParam[ outer ] locals[ art = new XsnArtifact() ]
@finally{ this.attachLocation( $art ); }
  :
    { this.docComment( $art ); } annoAssignStd[ $art ]*
    Id['ExtParam']
    { this.addDef( $art, $outer, 'params', 'annotate', this.identAst() ); }
    { this.docComment( $art ); } annoAssignStd[ $art ]*
    // annotateElementsBlock[ $art ]?  // TODO: why not
  ;

annotateReturns[ outer ] locals[ art = new XsnArtifact() ]
@finally{ this.attachLocation( $art ); if ($ret) art.location.tokenIndex = $ret.location.tokenIndex; }
  :
    ret=RETURNS { $outer.returns = $art; $art.kind = 'annotate'; }
    { this.docComment( $art ); } annoAssignStd[ $art ]*
    annotateElementsBlock[ $art ]?
  ;

annotateElementsBlock[ art ]
  :
    '{' { $art.elements = this.createDict(); }
    ( annotateElement[ $art ]
      ( ';'
      | <exitLoop>
      | <repeatLoop, guard=afterBrace, restrict=Id> { this.noAssignmentInSameLine(); }
      )
    )*
    '}'<prepare=afterBrace>
    { this.finalizeExtensionsDict( $art.elements ); }
  ;

annotateElement[ outer ] locals[ art = new XsnArtifact() ]
@finally{ this.attachLocation( $art ); }
  :
    { this.docComment( $art ); } annoAssignStd[ $art ]*
    Id['ExtElement']
    { this.addDef( $art, $outer, 'elements', 'annotate', this.identAst() ); }
    { this.docComment( $art ); } annoAssignStd[ $art ]*
    annotateElementsBlock[ $art ]?
  ;

extendElementsBlock[ art, start = undefined ]
  :
    '{' { $art.elements = this.createDict( $start ); }
    ( elementDefOrExtend[ $art ]
      ( ';'
      | <exitLoop>
      | <repeatLoop, guard=afterBrace, restrict=Id> { this.noAssignmentInSameLine(); } )
    )*
    '}'<prepare=afterBrace>
    { this.finalizeExtensionsDict( $art.elements ); }
  ;

elementDefOrExtend[ outer ] locals[ art = new XsnArtifact() ]
@finally{ this.checkWith( $keyword ); this.attachLocation( $art ); }
  :
    { $art.location = this.startLocation(); }
    { this.docComment( $art ); } annoAssignStd[ $art ]*
    (
      elementDef[ $outer, $art ]
    |
      EXTEND
      ( ELEMENT { $art.expectedKind = this.valueWithLocation(); } )?
      Id['ExtElement']
      { this.addDef( $art, $outer, 'elements', 'extend', this.identAst() ); }
      (
        { this.docComment( $art ); } annoAssignStd[ $art ]*
        extendElementsBlock[ $art ]?
      |
        keyword=WITH
        { this.docComment( $art ); } annoAssignStd[ $art ]*
        (
          elements=ELEMENTS? extendElementsBlock[ art, $elements ]
        |
          enumSymbolsBlock[ $art ] // ENUM …, just define, no extend
        |
          typeNamedArgsList[ $art ]
        )?
      )
    )
  ;

// Type expressions -------------------------------------------------------------

// For `type` and `annotation` definitions:
typeOrIncludesSpec[ art ]
  :
    elementsBlock[ $art ]
    nullability[ $art ]?
  |
    ':'
    (
      // Since cds-compiler v5.8; new parser only
      query=projectionSpec { $art.query = $query; $art.$syntax = 'projection'; }
    |
      typeExpression[ $art ]
    |
      <prefer>
      ref=simplePath { $art.type = $ref; }
      (
        // <default> does not work here
        typeRefOptArgs[ $art ]<atAltStart>
        ( typeExpression[ $art ]<atAltStart>
        | { this.docComment( $art ); }
        )
      |
        typeExpression[ $art ]<atAltStart>
      |
        { this.docComment( $art ); }
      |
        { $art.includes = [ $art.type ]; delete $art.type; }
        (
          ','
          (
            ref=simplePath { $art.includes.push( $ref ); }
            ( ',' | <exitLoop> )
          )*
        )?
        elementsBlock[ $art ]
        nullability[ $art ]?
      )
    )
  ;

// Type expression (after the `:`), including `null`/`not null` and `default`;
// the latter is forbidden in the `returns` type.
//
// This rule also parses annotation assignments and doc comments after the
// type/target reference and after each type property; exceptions are:
//  - not after element and `enum` blocks (would interfere with optional `;`)
//  - no further type property after `many …` @assignment`, because the
//    annotations are attached to the element, the type properties to the line type
//
// If used in a definition with additional clauses (currently just `= expr` for
// elements), these clauses must be guarded with <guard=…>.
//
// This rule is for element, type, (input and `returns`) parameter and annotation
// definitions.  It is not used when the type expression is restricted: CDL-style
// cast in `select` items, `cast` function, `mixin` definition.

typeExpression[ art ]
  :
    ( typeRefOptArgs[ $art ] | typeTypeOf[ $art ] )
    (<altRuleStart>)
    { this.docComment( $art ); } annoAssignStd[ $art ]*
    ( <guard=elementRestriction, arg=notNull> nullability[ $art ]
      { this.docComment( $art ); } annoAssignStd[ $art ]*
    )?
    ( enumSymbolsBlock[ $art ] <prepare=elementRestriction, arg=anno>
      ( <guard=elementRestriction, arg=notNull> nullability[ $art ] )?
      ( <guard=elementRestriction, arg=default>
        DEFAULT expr=expression { $art.default = $expr; }
      )?
      ( <guard=elementRestriction, arg=notNull> nullability[ $art ] )?
    | typeProperties[ $art ]
    )?
  |
    LOCALIZED { $art.localized = this.valueWithLocation( true ); }
    typeRefOptArgs[ $art ]      // no TYPE OF
    { this.docComment( $art ); }
    typeProperties[ $art ]?
  |
    assoc=ASSOCIATION <prepare=elementRestriction, arg=calc>
    cardinality[ $art ]? TO
    ( <guard=noRepeatedCardinality> card=ONE/MANY )?
    typeAssocProperties[ $art, $assoc, $card ]
  |
    assoc=COMPOSITION <prepare=elementRestriction, arg=calc>
    cardinality[ $art ]? OF
    ( <guard=noRepeatedCardinality> card=ONE/MANY )?
    ( typeAssocProperties[ $art, $assoc, $card ]
    | elementsBlock[ this.setAssocAndComposition( $art, $assoc, $card ) ]
      { $art.target.location = $art.target.elements[Symbol.for('cds.$location')]; }
    )
  |
    ( ARRAY <prepare=elementRestriction, arg=calc>
      OF  { $art.items = { location: this.locationOfPrevTokens( 2 ) }; }
    | MANY <prepare=elementRestriction, arg=calc>
      { $art.items = { location: this.lb().location }; }
    )                      // no anno assignments, except to end type expression
    (
      ( typeRefOptArgs[ $art.items ] | typeTypeOf[ $art.items ] )
      ( <guard=elementRestriction, arg=notNull> nullability[ $art.items ] )?
      ( { this.docComment( $art ); } annoAssignStd[ $art ]*
        { ; } <exitRule>         // TODO TOOL: make it work without workaround { ; }
        // TODO TOOL: investigate why simply `{} <exitRule>` is ignored
      | enumSymbolsBlock[ $art.items ]
      )
    |
      elementsBlock[ $art.items ]
    )
    ( <guard=elementRestriction, arg=notNull> nullability[ $art.items ] )?
  |
    elementsBlock[ $art ] <prepare=elementRestriction, arg=calc>
    nullability[ $art ]?
  ;

typeAssocProperties[ art, assoc, card ]
  :
    target=simplePath { this.setAssocAndComposition( $art, $assoc, $card, $target ); }
    { this.docComment( $art ); } annoAssignStd[ $art ]*
    ( ON cond=condition { $art.on = $cond; }
      { this.docComment( $art ); } annoAssignStd[ $art ]*
    | foreignKeysBlock[ $art ] { this.docComment( $art ); } typeProperties[ $art ]?
      // remark: no auto-`;` after foreign keys → anno assignment after it possible
    | typeProperties[ $art ]
    )?
  ;

typeProperties[ art ]
  :
    (
      annoAssignStd[ $art ]
    |
      <guard=elementRestriction, arg=notNull>
      nullability[ $art ] { this.docComment( $art ); }
    |
      <guard=elementRestriction, arg=default>
      DEFAULT expr=expression { $art.default = $expr; this.docComment( $art ); }
    )+
  ;


typeTypeOf[ art ] locals[ location ]
@after{ this.attachLocation( $art.type ); }
  :
    TYPE OF { location = this.locationOfPrevTokens( 2 ); }
    type=simplePath[ 'ref' ] { $art.type = $type; }
    (
      { $type.scope = 'typeOf'; $type.path.unshift( { id: 'type of', location } ); }
    |
      ':' { $type.scope = $type.path.length; }
      // If we have too much time, we could set the category of the simple path
      // before to 'artref'; but why use TYPE OF before `Art:elem` anyway?
      Id_all['ref'] { $type.path.push( this.identAst() ); }
      (
        '.' Id_all['ref'] { $type.path.push( this.identAst() ); }
      )*
    )
  ;

typeRefOptArgs[ art ] locals[ type = $art.type ]
  :
    type=simplePath { $art.type = $type; }
    (<altRuleStart>)
    (
      ':' { $type.scope = $type.path.length; }
      Id_all['ref'] { $type.path.push( this.identAst() ); }
      (
        '.' Id_all['ref'] { $type.path.push( this.identAst() ); }
      )*
      { this.attachLocation( $art.type ); }
    |
      open='('
      (
        Number { $art.$typeArgs = this.createArray( $open ); }
        { $art.$typeArgs.push( this.unsignedIntegerLiteral() ); }
        (
          ','
          ( Number
            { $art.$typeArgs.push( this.unsignedIntegerLiteral() ); }
          | tok=VARIABLE/FLOATING
            { $art.$typeArgs.push( { literal: 'string', val: $tok.keyword, location: $tok.location } ); }
          | <exitLoop>
          )
        )*                      // TODO: really as loop?
        { this.checkTypeArgs( $art ); } // might reset $art.$typeArgs
      |
        { $art.$typeArgs = this.createDict( $open ); }
        (
          typeNamedArg[ $art ]
          ( ',' | <exitLoop> )
        )+                      // TODO: really as loop?
      )
      ')' { if ($art.$typeArgs) this.finalizeDictOrArray( $art.$typeArgs ); }
    )?
  ;

typeNamedArgsList[ art ]
  :
    '(' { $art.$typeArgs = this.createDict(); }
    (
      typeNamedArg[ $art ]
      ( ',' | <exitLoop> )
    )*                      // TODO: really as loop?
    ')' { this.finalizeDictOrArray( $art.$typeArgs ); }
  ;

typeNamedArg[ art ]
  :
    // TODO: or keywords with guards for better code completion?
    name=Id['typeparamname']
    ':'
    ( Number
      { this.setTypeFacet( $art, $name, this.unsignedIntegerLiteral() ); }
    | tok=VARIABLE/FLOATING
      { this.setTypeFacet( $art, $name, { literal: 'string', val: $tok.keyword, location: $tok.location } ); }
    )
  ;

cardinality[ art ] locals[ card = {} ]
@finally{ $art.cardinality = this.attachLocation($card); }
  :
    '['
    (
      '*' { $card.targetMax = this.valueWithLocation(); }
      ( ',' targetCardinality[ $card ] )?
    |
      Number   { $card.targetMax = this.unsignedIntegerLiteral(); }
      (
        ',' targetCardinality[ $card ]
      |
        targetCardinality[ $card, true ]<atAltStart>
      )?
    |
      { $card.targetMax = this.valueWithLocation( '*' ); }
    )                           // TODO: really optional?
    ']'
  ;

targetCardinality[ card, atAlt = false ]
  :
    // TODO TOOL: the following action should not be executed when called
    // <atAltStart> → we can then remove param `atAlt`
    { if (!$atAlt) $card.sourceMax = $card.targetMax; }
    (
      '*'      { $card.targetMax = this.valueWithLocation(); }
    |
      Number   { $card.targetMax = this.unsignedIntegerLiteral(); }
      (<altRuleStart>)          // TODO TOOL: robust error when moved to after '('
      (
        '..'     { $card.targetMin = $card.targetMax; }
        ( '*'    { $card.targetMax = this.valueWithLocation(); }
        | Number { $card.targetMax = this.unsignedIntegerLiteral(); }
        )
      )?
    )
  ;

nullability[ art ]
  :
    NULL { this.setNullability( $art, false ); }
  |
    NOT NULL { this.setNullability( $art, true, this.locationOfPrevTokens( 2 ) ); }
  ;

// Queries: projections and SELECTs ---------------------------------------------

queryEOF returns[ query ]
  :
    $query=queryExpression ';'? EOF
  ;

projectionSpec returns[ default query = {} ]
@finally{ this.attachLocation($query); }
  :
    PROJECTION
    { $query = { op: this.valueWithLocation( 'SELECT' ) }; }
    ON
    tab=fromRefWithOptAlias
    { $query.from = tab; }
    selectItemsList[ $query ]?
    excludingClause[ $query ]?
  ;

queryExpression returns[ default expr = {} ] locals[ op, quantifier ]
@finally{ this.attachLocation( $expr ); }
  :
    ( '(' queryExpression[ ...$ ] ')' { this.surroundByParens( $expr ); }
      // remark: the SQL standard does not allow parens around a pure SELECT
    | $expr=selectQuery <prepare=orderByLimitRestriction>
    )
    (<altRuleStart>)
    (
      // See also `taggedIfQuery`/`queryOps` in AstBuildingParser.js
      ( ( <prec=4> INTERSECT { $op = this.valueWithLocation(); }
        | <prec=2> EXCEPT/MINUS { $op = this.valueWithLocation(); }
        )
        ( DISTINCT { $quantifier = this.valueWithLocation(); } )?
      | <prec=2> UNION { $op = this.valueWithLocation(); }
        ( DISTINCT/ALL { $quantifier = this.valueWithLocation(); } )?
      )
      query=queryExpression <prepare=orderByLimitRestriction>
      // with same op/quantifier: make left-assoc binary to nary:
      { if ($expr.$parens || $op.val !== $expr.op?.val || $quantifier?.val !== $expr.quantifier?.val) $expr = { op, args: [$expr], quantifier, location: { ...$.expr.location } }; } // TODO: ...$
      { $quantifier = undefined; }
      { $expr.args.push( $query ); this.attachLocation( $expr ); }
    )*
    ( <guard=orderByLimitRestriction> // prec=0 + test that only used once after SELECT or SET op
      orderByLimitOffset[ $expr ]
    )?
  ;

selectQuery returns[ default query = {} ]
@finally{ this.attachLocation($query); }
  :
    SELECT { $query = { op: this.valueWithLocation( 'SELECT' ) }; }
    (
      FROM querySource[ $query ]
      (
        MIXIN '{' { $query.mixin = this.createDict(); }
        (
          mixinElementDef[ $query ]
          ( ';' | <exitLoop> )
        )*
        '}' { this.finalizeDictOrArray( $query.mixin ); }
        INTO
      )?
      ( ALL/DISTINCT { $query.quantifier = this.valueWithLocation(); } )?
      // TODO: or directly after SELECT ?
      selectItemsList[ $query ]?
      excludingClause[ $query ]?
    |
      ( ALL/DISTINCT { $query.quantifier = this.valueWithLocation(); } )?
      // TODO TOOL: move <prepare> to all branches if "simple", or with special <…,attach>
      {;} <prepare=inSelectItem, arg=sqlStyle>
      ( '*' { $query.columns = [ this.valueWithLocation() ]; }
      | selectItemDef[ ($query.columns = []) ]
      )
      ( ','
        ( '*' { $query.columns.push( this.valueWithLocation() ); }
        | selectItemDef[ $query.columns ]
        )
      )*
      FROM querySource[ $query ]
    )
    whereGroupByHaving[ $query ]?
  ;

querySource[ query ]
@after { this.attachLocation($query.from); }
  :
    tab=tableExpression { $query.from = $tab; }
    (
      { const { location } = this.la();
        $query.from = { op: { val: 'join', location }, join: { val: 'cross', location }, args: [$tab] };
      }
      ( ',' tab=tableExpression { $query.from.args.push( $tab ); } )+
    )?
  ;

tableExpression returns[ default expr = {} ] // TableOrJoin
  :
    ( tableOrQueryParens[ ...$ ]
      (<altRuleStart> { $expr = this.taggedIfQuery( $expr ); } )
    | fromRefWithOptAlias[ ...$ ]
    )
    (
      join=CROSS JOIN
      { if ($expr?.join?.val !== 'cross' || $expr.$parens) $expr = { op: this.valueWithLocation(), join: this.valueWithLocation( undefined, $join ), args: [ $expr ] }; }
      ( tab=tableOrQueryParens { const r = this.taggedIfQuery( $tab ); if (r) $expr.args.push( r ); }
        { this.attachLocation( $expr ); }
      | tab=fromRefWithOptAlias { if ($tab) $expr.args.push( $tab ); }
        { this.attachLocation( $expr ); }
      )
    |
      ( ( join=INNER | join=LEFT/RIGHT/FULL OUTER? )
        card=joinCardinality? JOIN
      | JOIN { $join = undefined; }
      )
      // TODO TOOL: allow zero-alt in choice in outer alt → JOIN can be moved outside
      { $expr = { op: this.valueWithLocation(), join: this.valueWithLocation( $join?.keyword || 'inner', $join ), args: [ $expr ] }; if ($card) $expr.cardinality = $card; $card = undefined; }
      tab=tableExpression
      { $expr.args.push( $tab ); this.attachLocation( $expr ); }
      ON cond=condition { $expr.on = $cond; }
      { this.attachLocation( $expr ); }
    )*
  ;

tableOrQueryParens returns[ default expr ]
  :
    '(' <prepare=queryOnLeft>
    ( <prefer> tableOrQueryParens[ ...$ ]
      ( tableExpression[ ...$ ]<atAltStart, prepare=queryOnLeft, arg=table>
      | <guard=queryOnLeft> queryExpression[ ...$ ]<atAltStart>
      )?
    | tableExpression[ ...$ ] <prepare=queryOnLeft, arg=table>
    | queryExpression[ ...$ ]
    )
    ')'
    { this.surroundByParens( $expr ); }
    ( <guard=queryOnLeft, arg=table> AS Id['FromAlias']
      { $expr = this.taggedIfQuery( $expr ); $expr.name = this.identAst(); }
    | <guard=queryOnLeft, arg=tableWithoutAs> Id_restricted['FromAlias']
      // TODO TOOL: shouldn't we have generated `default: this.giR()`?
      { $expr = this.taggedIfQuery( $expr ); $expr.name = this.fragileAlias(); }
    )?
  ;                             // change #10799 for ANTLR-based parser

joinCardinality returns[ sourceMax, targetMax ]
@finally{ this.attachLocation( $ ); }
  :
    (
      ( EXACT { $.sourceMin = this.valueWithLocation( 1 ); } )?
      ONE { $sourceMax = this.valueWithLocation( 1 ); }
    |
      MANY { $sourceMax = this.valueWithLocation( '*' ); }
    )
    TO
    (
      ( EXACT { $.targetMin = this.valueWithLocation( 1 ); } )?
      ONE { $targetMax = this.valueWithLocation( 1 ); }
    |
      MANY { $targetMax = this.valueWithLocation( '*' ); }
    )
  ;

fromRefWithOptAlias returns[ default expr = {} ]
@finally{ this.attachLocation( $expr ); }
  :
    { $expr.path = []; }
    fromPath[ $expr, 'artref' ]
    (
      ':' { if (!$expr.scope) $expr.scope = $expr.path.length; else {
        this.warning( 'syntax-invalid-path-separator', this.lb(),
                      { '#': 'colon', code: ':', newcode: '.' } );
      } }
      fromPath[ $expr, 'ref']
    )?
    (
      AS Id['FromAlias'] { $expr.name = this.identAst(); }
    |
      // <guard=tableWithoutAs> not necessary, tool uses `default: this.giR()`
      Id_restricted['FromAlias']
      { $expr.name = this.fragileAlias(); }
    |
      <default=fallback>
      { this.classifyImplicitName( $expr.scope ? 'FromElemImplicit' : 'FromImplicit', $expr ); }
    )
  ;

fromPath[ table, category ] locals[ pathItem ]
@finally{ this.attachLocation( $table.path ); }
  :
    Id[ $category ] { $table.path.push( $pathItem = this.identAst() ); }
    ( fromArgumentsAndFilter[ $pathItem ] { $pathItem = null; } )?
    (
      <guard=notAfterEntityArgOrFilter> // TODO TOOL: allow <hide=method>
      '.' { if (!$pathItem && !$table.scope) {
        $table.scope = $table.path.length; $category = 'ref';
        this.warning( 'syntax-invalid-path-separator', this.lb(),
                      { '#': 'dot', code: '.', newcode: ':' } );
      } }
      Id_all[ $category ] { $table.path.push( $pathItem = this.identAst() ); }
      ( fromArgumentsAndFilter[ $pathItem ] { $pathItem = null; } )?
    )*
  ;

fromArgumentsAndFilter[ pathStep ]
options{ minTokensMatched = 1 }
  :
    (
      '(' { $pathStep.args = this.createDict(); $pathStep.$syntax = ':'; }
      ( fromNamedArgument[ ...$ ]
        ( ',' | <exitLoop> )
      )+
      ')'
    )?
    cardinalityAndFilter[ ...$ ]?
  ;

fromNamedArgument[ pathStep ]
  :
    name=Id['paramname'] ':' expr=expression
    { this.addDef( $expr, $pathStep, 'args', 0, this.identAst( $name ) ); }
    // TODO: or add argument directly after having parsed the name? (for CC)
  ;

cardinalityAndFilter[ pathStep ]
  :
    '['
    ( <guard=beforeColon> Number // TODO: only allow `1`?
      { $pathStep.cardinality = { targetMax: this.unsignedIntegerLiteral(), location: this.lb().location }; }
      ':'
    )?
    filterClauses[ $pathStep ]
    // TODO: why not allowing all clauses to be optional? (then inline rule `filterClauses`)
    ']'
  ;

filterClauses[ pathStep ]
options{ minTokensMatched = 1 }
  :
    ( WHERE?
      // compare GROUP/HAVING/ORDER/LIMIT w/o prediction (reserved WHERE anyway):
      // <restrict=Id>  // TODO TOOL: not yet supported here
      // BTW, why? not necessary anymore…
      cond=condition { $pathStep.where = $cond; }
    )?
    ( <hide>
      { this.csnParseOnly('syntax-unexpected-sql-clause', 1, { keyword: 'group by' }); }
      groupByClause[ $pathStep ]
    )?
    ( <hide> HAVING
      { this.csnParseOnly('syntax-unexpected-sql-clause', -1, { keyword: 'having' }); }
      cond=condition { $pathStep.having = $cond; }
    )?
    ( <hide>
      { if (this.lk() === 'limit') this.csnParseOnly('syntax-unexpected-sql-clause', 0, { keyword: 'limit' } ); else this.csnParseOnly('syntax-unexpected-sql-clause', 1, { keyword: 'order by' } ); }
      // I do not care that there is now only one error msg for both ORDER BY … LIMIT …
      orderByLimitOffset[ $pathStep ]
    )?
  ;

excludingClause[ query ]
  :
    // syntax is less than ideal - EXCLUDING is only useful for `*` - with
    // this syntax, people wonder what happens with explicit select items
    EXCLUDING '{' { $query.excludingDict = this.createDict(); }
    // TODO: better move '{' to after action, but → diff to ANTLR-based parser
    (
      Id_all['ref']             // TODO: different category?
      { this.addDef( { location: this.lb().location }, $query, 'excludingDict', '', this.identAst() ); }
      ( ',' | <exitLoop> )
    )+
    '}'<prepare=afterBrace>
    { this.finalizeDictOrArray( $query.excludingDict ); }
  ;

selectItemsList[ query, start = undefined ]
  :
    '{'<prepare=inSelectItem, arg=top>
    { $query.columns = this.createArray( $start ); }
    (
      ( '*' { $query.columns.push( this.valueWithLocation() ); }
      | selectItemDef[ $query.columns ]
      )
      ( ',' | <exitLoop> )
    )*
    '}'<prepare=afterBrace>
    { this.finalizeDictOrArray( $query.columns ); }
  ;

nestedSelectItemsList[ query, clause ]
  :
    '{'<prepare=inSelectItem>
    { $query[$clause] = this.createArray(); }
    (
      ( '*' { $query[$clause].push( this.valueWithLocation() ); }
      | selectItemDef[ $query[$clause] ]
      )
      ( ',' | <exitLoop> )
    )*
    '}'<prepare=afterBrace>
    { this.finalizeDictOrArray( $query[$clause] ); }
  ;

selectItemDef[ columns ] locals[ art = new XsnArtifact() ]
@finally{ this.attachLocation( $art ); }
  :
    { $columns.push( $art ); }  // TODO: probably too early
    { this.docComment( $art ); } annoAssignCol[ $art ]*
    ( <guard=modifierRestriction> VIRTUAL
      { $art.virtual = this.valueWithLocation( true ); }
    )?
    {;} <prepare=columnExpr, arg=key>    // TOOL TODO: disappears without {;}
    ( <guard=modifierRestriction> KEY
      { $art.key = this.valueWithLocation( true ); }
    )?
    // TODO: we might have an extra rule for column expression...
    (
      (
        expr=expression { $art.value = $expr; }
        ( AS Id['ItemAlias'] { $art.name = this.identAst(); }
        | Id_restricted['ItemAlias'] { $art.name = this.fragileAlias( true ); }
        )?
      |
        <prefer>
        expr=valuePath { $expr = this.valuePathAst( $expr ); $art.value = $expr; }
        (
          (
            OVER { this.pushXprToken( $expr.suffix = [] ); }
            overClause[ $expr.suffix ]
            ( e=expression[ ...{ expr: $expr } ]<atAltStart>
              { Object.assign( $e.location || {}, $expr.location ); $art.value = this.attachLocation( $e )}
            )?
          |
            e=expression[ ...{ expr: $expr } ]<atAltStart>
            { Object.assign( $e.location || {}, $expr.location ); $art.value = this.attachLocation( $e )}
          )
          ( AS Id['ItemAlias'] { $art.name = this.identAst(); }
          | Id_restricted['ItemAlias'] { $art.name = this.fragileAlias( true ); }
          )?
        |                         // includes empty
          AS Id['ItemAlias'] <prepare=nestedExpand> { $art.name = this.identAst(); }
        |
          Id_restricted['ItemAlias'] <prepare=nestedExpand>
          { $art.name = this.fragileAlias( true ); }
        |
          { this.virtualOrImplicit( $art ); } <prepare=nestedExpand>
          // TODO TOOL: action in default does not work in embedded action
        |
          // TODO: guard instead reportExpandInline if valuePath is function?
          '.'
          { this.reportUnexpectedSpace( this.lb(), this.la().location, true ); } // TODO: no ERR
          { this.reportExpandInline( $art, true ); }
          // no extra 'syntax-unexpected-alias' anymore,
          // 'syntax-unexpected-anno' reported in define.js
          (
            nestedSelectItemsList[ $art, 'inline' ]
            excludingClause[ $art ]?
          |
            '*' { $art.inline = [ this.valueWithLocation() ]; }
          )
          <exitRule>
        )
      )
      // expand is only allowed only after valuePath, but error recovery is poor
      // if the following is moved up to <prepare=nestedExpand>
      (
        // TODO: make guard handle that if valuePath might be function?
        <guard=nestedExpand>
        { if (!this.nestedExpand(true)) this.reportExpandInline( $art, false ); }
        nestedSelectItemsList[ $art, 'expand' ]
        excludingClause[ $art ]?
      )?
    |
      nestedSelectItemsList[ $art, 'expand' ]
      excludingClause[ $art ]?
      AS Id['ItemAlias'] { $art.name = this.identAst(); }
    )
    { this.docComment( $art ); } <prepare=columnExpr> annoAssignMid[ $art ]*
    (
      ':'                       // TODO: guard? currently not with expand ?
      (
        ( typeTypeOf[ $art ]
        | ( LOCALIZED { $art.localized = this.valueWithLocation( true ); } )?
          typeRefOptArgs[ $art ]
        )
      |
        // TODO: guard for ref-only expression ?
        REDIRECTED TO target=simplePath { $art.target = $target; }
        ( ON cond=condition { $art.on = $cond; }
        | foreignKeysBlock[ $art ]
        )?
      |
        ( <guard=columnExpr>     // arg=singleId
          assoc=ASSOCIATION { this.associationInSelectItem( $art ); }
          cardinality[ $art ]? TO
        | <guard=columnExpr>     // arg=singleId
          assoc=COMPOSITION { this.associationInSelectItem( $art ); }
          cardinality[ $art ]? OF
        )
        ( <guard=noRepeatedCardinality> card=ONE/MANY )?
        target=simplePath
        { this.setAssocAndComposition( $art, $assoc, $card, $target ); }
        ON expr=condition { $art.on = $expr; }
      )
      // TODO: no nullability here ?
      { this.docComment( $art ); } annoAssignStd[ $art ]*
    )?
  ;

whereGroupByHaving[ query ]
options{ minTokensMatched = 1 }
  :
    ( WHERE cond=condition { $query.where = $cond; } )?
    groupByClause[ ...$ ]?
    ( HAVING cond=condition { $query.having = $cond; } )?
  ;

groupByClause[ query ]
  :
    GROUP BY expr=expression { $query.groupBy = [ $expr ]; }
    ( ',' expr=expression { $query.groupBy.push( $expr ); } )*
  ;

orderByLimitOffset[ query ]
options{ minTokensMatched = 1 }
  :
    orderByClause[ ...$ ]?
    ( LIMIT expr=expression { $query.limit = { rows: $expr }; }
      ( OFFSET expr=expression { $query.limit.offset = $expr; } )?
    )?
  ;

orderByClause[ query ]
  :
    ORDER BY expr=orderByExpression { $query.orderBy = [ $expr ]; }
    ( ',' expr=orderByExpression { $query.orderBy.push( $expr ); } )*
  ;

orderByExpression returns[ default expr ]
  :
    expression[ ...$ ]
    ( ASC/DESC { $expr.sort = this.valueWithLocation(); } )?
    ( NULLS FIRST/LAST { $expr.nulls = this.valueWithLocation(); } )?
  ;

// Conditions and expressions ---------------------------------------------------

conditionEOF returns[ cond ]
  :
    $cond=expression EOF
  ;

condition returns[ default expr ]
  :
    expression[ ...$ ]
  ;

valuePath returns[ default expr = { path: [] } ] locals[ pathItem ]
@finally{ this.attachLocation( $expr ); }
  :
    Id['ref'] { $expr.path.push( $pathItem = this.identAst() ); }
    ( argumentsAndFilter[ $pathItem ] )?
    (<altRuleStart>)
    (
      <guard=isDotForPath> '.'
      Id_all['ref'] { $expr.path.push( $pathItem = this.identAst() ); }
      ( argumentsAndFilter[ $pathItem ] { $pathItem = null; } )?
    )*
  ;

expression returns[ default expr = {} ]
@finally{ if (this.s == null) this.attachLocation( $expr ); }
  :
    (
      expressionOrQueryParens[ ...$ ]
      (<altRuleStart> { $expr = this.taggedIfQuery( $expr ); })
    |
      literalValue[ ...$ ]
    |
      ':' { this.reportUnexpectedSpace(); }
      (
        Id_all['paramref']
        { $expr = { path: [ this.identAst() ], location: this.startLocation(), scope: 'param' }; }
        ( valuePath[ ...$ ]<atAltStart>
          { $expr = this.valuePathAst( $expr ); }
        | { this.attachLocation( $expr ); }
        )
      |
        <hide> Number           // TODO: as user condition
        { this.csnParseOnly( 'syntax-unsupported-param', -1, { '#': 'positional', code: ':' + this.lb().text } ); }
        { $expr = this.attachLocation({ param: this.unsignedIntegerLiteral(), scope: 'param' }); }
      )
    |
      <hide> '?'              // TODO: do as user condition
      {this.csnParseOnly( 'syntax-unsupported-param', -1, { '#': 'dynamic', code: '?' } );
      }
      { $expr = this.attachLocation({ param: this.valueWithLocation(), scope: 'param' }); }
    |
      e=valuePath { $expr = this.valuePathAst( $e ); }
      (
        OVER { this.pushXprToken( $expr.suffix = [] ); }
        e=overClause[ $expr.suffix ]
      )?
      { this.attachLocation( $expr ); }
    |
      NEW { $expr = this.applyOpToken(); }
      e=valuePath { this.valuePathAstWithNew( $expr, $e ); }
    |
      EXISTS { $expr = this.applyOpToken(); }
      ( open='(' e=queryExpression ')'
        { $expr.args.push( this.taggedIfQuery( this.surroundByParens( $e, $open ) ) ); }
        { this.attachLocation( $expr ); }
      | e=valuePath { $e = this.valuePathAst( $e ); $e.$expected = 'exists'; }
        // TODO: re-check whether to really set $expected in parser
        { $expr.args.push( $e ); this.attachLocation( $expr ); }
      | <hide> '?'              // TODO: do as user condition
        {this.csnParseOnly( 'syntax-unsupported-param', -1, { '#': 'dynamic', code: '?' } ); }
        { $expr.args.push( { param: this.valueWithLocation(), scope: 'param' } ); this.attachLocation( $expr ); }
      )
    |
      caseExpression[ ...$ ]
    |
      castFunction[ ...$ ]
    |
      ( <prec=30, prefix> '+'/'-' { $expr = this.applyOpToken(); }
      | <prec=8, prefix>  NOT     { $expr = this.applyOpToken(); }
      )
      e=expression { $expr = this.signedExpression( $expr, $e ); }
    )
    // binary + postfix
    ( (
        ( <prec=24> '*'/'/' { $expr = this.applyOpToken( $expr, 'nary' ); }
        | <prec=22> '+'/'-' { $expr = this.applyOpToken( $expr, 'nary' ); }
        | <prec=20> '||'    { $expr = this.applyOpToken( $expr, 'nary' ); }
        | <prec=4> AND      { $expr = this.applyOpToken( $expr, 'nary' ); }
        | <prec=2> OR       { $expr = this.applyOpToken( $expr, 'nary' ); }
        | <prec=0> '?'      { $expr = this.applyOpToken( $expr, '?:' ); }
          e=expression { $expr.args.push( $e ); }
          ':' { this.pushXprToken( $expr ); }
          // -> createXprForOp vs createAstForOp

        | <prec=10, assoc=none> '='/'<>'/'>'/'>='/'<'/'<='/'!='
          { $expr = this.applyOpToken( $expr ); }
          ( ANY/SOME/ALL { this.pushXprToken( $expr ); } )?
        | <prec=10, assoc=none> '=='
          { $expr = this.applyOpToken( $expr ); }
        )
        e=expression { $expr.args.push( $e ); }

      | <prec=10, postfix=once> IS { $expr = this.applyOpToken( $expr ); }
        ( NOT { this.pushXprToken( $expr ); } )?
        NULL { this.pushXprToken( $expr ); }
      | ( <arg=10, guard=isNegatedRelation> NOT { $expr = this.applyOpToken( $expr ); }
          // TODO: condition, because there might be NOT NULL after DEFAULT expression
        | <prec=10, postfix=once>
          { $expr = { op: { val: 'ixpr', location: this.la().location }, args: [ $expr ] }; }
        )
        (
          BETWEEN { this.pushXprToken( $expr ); }
          e=expression { $expr.args?.push( $e ); }
          AND { this.pushXprToken( $expr ); }
          e=expression { $expr.args?.push( $e ); }
        | IN { this.pushXprToken( $expr ); }
          e=expression { $expr.args?.push( this.secureParens( $e ) ); }
        | LIKE { this.pushXprToken( $expr ); }
          e=expression { $expr.args?.push( $e ); }
          ( ESCAPE { this.pushXprToken( $expr ); }
            e=expression { $expr.args?.push( $e ); }
          )?
        )
      )
      { this.attachLocation( $expr ); }
    )*
  ;

expressionOrQueryParens returns[ default expr ]
  :
    '(' <prepare=queryOnLeft>
    ( <prefer> expressionOrQueryParens[ ...$ ]
      ( expression[ ...$ ]<atAltStart, prepare=queryOnLeft, arg=expr>
        continueExpressionslist[ ...$ ]?
      | continueExpressionslist[ ...$ ] <prepare=queryOnLeft, arg=expr>
      | <guard=queryOnLeft> queryExpression[ ...$ ]<atAltStart>
      )?
    | expression[ ...$ ] <prepare=queryOnLeft, arg=expr>
      continueExpressionslist[ ...$ ]?
    | queryExpression[ ...$ ]
    )
    ')'
    { this.surroundByParens( $expr ); }
  ;

continueExpressionslist[ expr ]
@finally{ this.attachLocation( $expr ); }
  :
    ',' { $expr = { op: this.valueWithLocation( 'list' ), args: [ $expr ], location: { ... $expr.$parens?.at( -1 ) ?? $expr.location } }; }
    (
      e=expression { $expr.args.push( $e ); }
      ( ',' | <exitLoop> )
    )+
  ;

caseExpression returns[ default expr ]
@finally{ this.attachLocation( $expr ); }
  :
    CASE { $expr.op = { val: 'ixpr', location: this.lb().location }; $expr.args = []; this.pushXprToken( $expr ); }
    ( e=expression { $expr.args.push( $e ); } )?
    (
      WHEN { this.pushXprToken( $expr ); }
      e=expression { $expr.args.push( $e ); }
      THEN { this.pushXprToken( $expr ); }
      e=expression { $expr.args.push( $e ); }
    )+
    (
      ELSE { this.pushXprToken( $expr ); }
      e=expression { $expr.args.push( $e ); }
    )?
    END { this.pushXprToken( $expr ); }
  ;

castFunction returns[ default expr ]
@finally{ this.attachLocation( $expr ); }
  :
    CAST { $expr.op = this.valueWithLocation(); }
    '(' { $expr.args = this.createArray(); }
    arg=expression { $expr.args?.push( $arg ); }
    AS typeRefOptArgs[ $expr ]
    ')' { this.finalizeDictOrArray( $expr.args ); }
  ;

argumentsAndFilter[ pathStep ]
// TODO: what about valuePath with EXISTS, after `:` etc (also in ANTLR-based parser)?
options{ minTokensMatched = 1 }
  :
    (
      open='(' <prepare=prepareSpecialFunction>
      { $pathStep.args = this.createArray(); }
      // action here, default action won't be executed with failed condition (TODO
      // TOOL? at least msg)
      (
        // TODO: if we want perfect CC and error recovery, `isNamedArg` would not
        // only check the next token for the ':'/'=>', but probably also for the
        // one after that, at least if the next token could not be a valid
        // operator (consider that parameter references look like `:PAR`)
        <guard=isNamedArg> id=Id_all['paramname']
        (
          ':' { $pathStep.args = this.createDict( $open ); $pathStep.$syntax = ':'; }
          expr=expression { this.addNamedArg( $pathStep, $id, $expr ); }
          ( ','
            ( id=Id_all['paramname'] ':'
              expr=expression { this.addNamedArg( $pathStep, $id, $expr ); }
            | <exitLoop>
            )
          )*
        |
          '=>' { $pathStep.args = this.createDict(); }
          // TODO: potentially special expressions for special functions
          expr=expression { this.addNamedArg( $pathStep, $id, $expr ); }
          ( ','
            ( id=Id_all['paramname'] '=>'
              expr=expression { this.addNamedArg( $pathStep, $id, $expr ); }
            | <exitLoop>
            )
          )*
        )
      |
        <default=fallback>
        (
          expr=funcExpression { $pathStep.args.push( $expr ); }
          (
            ','<prepare=nextFunctionArgument>
            ( expr=funcExpression { $pathStep.args.push( $expr ); }
            | <exitLoop, guard=atRightParen>
              // TODO: later allow ')' <exitRule>, or ')'<mock, exitLoop>, or <exitBlock=MainAlt> with ( options{ block=MainAlt }: …)
            )
          )*
          (   // ORDER BY in generic functions, e.g. `first_value(id order by name)`
            ORDER { $expr = $pathStep.args[$pathStep.args.length - 1] = this.applyOpToken( $expr ); }
            BY { this.pushXprToken( $expr ); }
            orderByClauseAsXpr[ $expr.args ]
            { this.attachLocation( $expr ); }
          )?
        )?
      )
      ')' { this.finalizeDictOrArray( $pathStep.args ); }
    )?
     // TODO: not with function!
    cardinalityAndFilter[ ...$ ]?
  ;

funcExpression returns[ default expr ] locals[ args ]
@finally{ this.attachLocation( $expr ); }
  :
    ( options{ lookahead = lGenericIntroOrExpr; }
    :
      $expr=expression
    |
      tok=GenericExpr               // keyword as replacement for expression, like '*'
      { $expr = { val: $tok.keyword ?? $tok.type, location: $tok.location, literal: 'token' }; }
    |
      GenericIntro      // keyword as introduction of expression, like DISTINCT
      { $expr = this.applyOpToken(); $args = $expr.args; }
      e=expression { $expr.args.push( $e ); }
    )
    // TODO: some <restrict=Id> here?
    ( options{ lookahead = lGenericSeparator; }
    :
      GenericSeparator
      { if ($args) this.pushXprToken( $args ); else { $expr= this.applyOpToken( $expr ); $args = $expr.args; } }

      ( options{ lookahead = lGenericExpr; }
      :
        e=expression { $args.push( $e ); }
      |
        GenericExpr { this.pushXprToken( $args ); }
      )
    )*
  ;

// TODO: check Id_all - necessary if generic token is a reserved word?
GenericExpr // workaround TODO Runtime: no-skip/exit recovery w/o guards, see #13485
  : Id_all | '*' | DeleteStarFromSet ; // → DeleteStarFromSet to avoid failing on same token
GenericIntro
  : Id_all ;
GenericSeparator
  : Id_restricted ;             // otherwise expression ops use keyword prediction
// TODO TOOL: use `<restrict=Id> GenericSeparator` instead and back to Id_all or Id

overClause[ outer ] locals[ over = [] ]
@finally{ $outer.push( this.surroundByParens( this.ixprAst( $over ) ) ); }
  :
    '('
    ( PARTITION { this.pushXprToken( $over ); } BY { this.pushXprToken( $over ); }
      expressionsAsXpr[ $over ]
    )?
    ( ORDER { this.pushXprToken( $over ); } BY { this.pushXprToken( $over ); }
      orderByClauseAsXpr[ $over ]
    )?
    ( ROWS { this.pushXprToken( $over ); }
      windowFrameClause[ $over ]
    )?
    ')'
  ;

expressionsAsXpr[ outer ] locals[ args = [] ]
@finally{ $outer.push( this.ixprAst( $args ) ); }
  :
    expr=expression { $args.push( $expr ); }
    ( ',' { this.pushXprToken( $args ); }
      expr=expression { $args.push( $expr ); }
    )*
  ;

orderByClauseAsXpr[ outer ] locals[ args = [] ]
@finally{ $outer.push( this.ixprAst( $args ) ); }
  :
    orderBySpecAsXpr[ $args ]
    ( ',' { this.pushXprToken( $args ); }
      orderBySpecAsXpr[ $args ]
    )*
  ;

orderBySpecAsXpr[ args ]
  :
    expr=expression { $args.push( $expr ); }
    ( ASC/DESC { this.pushXprToken( $args ); } )?
    ( NULLS { this.pushXprToken( $args ); }
      FIRST/LAST { this.pushXprToken( $args ); }
    )?
  ;

windowFrameClause[ outer ] locals[ args = [] ]
@finally{ $outer.push( this.ixprAst( $args ) ); }
  :
    ( UNBOUNDED { this.pushXprToken( $args ); }
    | Number { $args.push( this.unsignedIntegerLiteral() ); }
    )
    PRECEDING { this.pushXprToken( $args ); }
  |
    CURRENT { this.pushXprToken( $args ); }
    ROW { this.pushXprToken( $args ); }
  |
    BETWEEN { this.pushXprToken( $args ); }
    windowFrameBoundSpec[ $args ]
    AND { this.pushXprToken( $args ); }
    windowFrameBoundSpec[ $args ]
  ;

windowFrameBoundSpec[ args ]
  :
    ( UNBOUNDED { this.pushXprToken( $args ); }
    | Number { $args.push( this.unsignedIntegerLiteral() ); }
    )
    ( FOLLOWING | PRECEDING ) { this.pushXprToken( $args ); }
  |
    CURRENT { this.pushXprToken( $args ); }
    ROW { this.pushXprToken( $args ); }
  ;

literalValue returns[ default expr = {} ]
@finally{ this.attachLocation( $expr ); }
  :
   // TODO: remove from this rule (not in enum! `String enum { foo = #bar }`) ?
    '#' { this.reportUnexpectedSpace(); }
    Id_all['enumref']
    { $expr = { literal: 'enum', sym: this.identAst() } }
  |
    NULL
    { $expr = { literal: 'null', val: null }; }
  |
    TRUE/FALSE
    { $expr = { literal: 'boolean', val: this.lb().keyword === 'true' }; }
  |
    Number
    { $expr = this.numberLiteral(); } // allow float and large number
  |
    String
    { $expr = this.quotedLiteral(); }
  |
    QuotedLiteral               // x'12', date'...', time'...', timestamp'...'
    { $expr = this.quotedLiteral(); }
  ;

// Annotation assignments -------------------------------------------------------

// We have three versions of the annotation assignment rules:
//  - "…Std": typically before keyword+name, after a name if no ':' could follow
//  - "…Col": at the beginning of a column def, which can start with ':' or '#'
//  - "…Mid": typically after a name if a ':' could follow

annoAssignStd[ art ]
@finally{ this.docComment( $art ); }
  :
    '@'<prepare=annoInSameLine> { this.reportUnexpectedSpace(); }
    ( annoAssignParen[ ...$ ]
    | annoAssignBase[ ...$ ]
    )
  ;

annoAssignCol[ art ]
@finally{ this.docComment( $art ); }
  :
    '@' { this.reportUnexpectedSpace(); }
    ( annoAssignParen[ ...$ ]
    | annoAssignBase[ ...$ ]
    )
  ;

annoAssignMid[ art ]
@finally{ this.docComment( $art ); }
  :
    '@'<prepare=annoInSameLine> { this.reportUnexpectedSpace(); }
    ( annoAssignParen[ ...$ ]
    | name=annoNamePath         // !
      { this.assignAnnotation( $art, {}, $name ); this.warnIfColonFollows( $name ); }
    )
  ;

annoAssignParen[ art ]
  :
    '('<prepare=annoInSameLine>
    ( annoAssignBase[ $art ]
      //( annoAssignErrorRecoveryHelper )?
      ( ',' | <exitLoop> )
    )*
    ')'
  ;

annoAssignBase[ art ] locals[ value = {} ]
@finally{ this.assignAnnotation( $art, $value, $name || {} ); }
  :
    name=annoNamePath
    ( <guard=annoInSameLine> ':' value=annoValue )?
  ;

annoNamePath[ category = 'anno' ] returns[ default name = new XsnName() ]
@finally{ this.attachLocation( $name ); }
  :
    Id_all[ $category ]
    { $name.path = [ this.identAst() ]; }
    (
      '.'
      ( Id_all[ $category ] { $name.path.push( this.identAst() ); }
      | at='@'                  // TODO: complain about spaces after?
        Id_all[ $category ] { $name.path.push( this.identAstWithPrefix( $at ) ); }
      )
    )*
    ( <guard=annoInSameLine> annoPathVariant[ $name ] )?
  ;

annoPath[ nameOrRef, category = 'annoref' ]
@finally{ this.attachLocation( $nameOrRef ); }
  :
    ( Id_all[ $category ] { $nameOrRef.path = [ this.identAst() ]; }
    | at='@'                  // TODO: complain about spaces after?
      Id_all[ $category ] { $nameOrRef.path = [ this.identAstWithPrefix( $at ) ]; }
    )
    (
      '.'
      ( Id_all[ $category ] { $nameOrRef.path.push( this.identAst() ); }
      | at='@'                  // TODO: complain about spaces after?
        Id_all[ $category ] { $nameOrRef.path.push( this.identAstWithPrefix( $at ) ); }
      )
    )*
    annoPathVariant[ $nameOrRef ]?
  ;

annoPathVariant[ nameOrRef ]
@finally{ this.attachLocation( $nameOrRef.variant ); }
  :
    '#' { this.reportUnexpectedSpace(); }
    Id_all['variant'] { $nameOrRef.variant = { path: [ this.identAst() ] }; }
    (
      '.' Id_all['variant'] { $nameOrRef.variant.path.push( this.identAst() ); }
    )*
  ;

annoStructValue returns[ default value = {} ] locals[ name = new XsnName()  ]
@finally{ $value.name = $name; }
  :
    annoPath[ $name, 'name' ] { this.attachLocation( $name ); }
    ( ':'
      $value=annoValue
    |
      { this.attachLocation( $value ); }
    )
  ;

annoValue returns[ default value = {} ]
@finally{ this.attachLocation( $value ); }
  :
    $value=literalValue { this.adjustAnnoNumber( $value ); }
  |
    sign='+'/'-' Number
    { this.adjustAnnoNumber( $value = this.numberLiteral( $sign ) ); }
  |
    annoPath[ $value, 'annoref' ]
  |
    '{'
    {
      if (!this.dynamic_.arrayAnno) $value.$flatten = [];
      else { $value.struct = Object.create(null); $value.literal = 'struct'; }
    }
    (
      // TOOL TODO → allow `<guard=…> '}'` below where the condition rejects `}`
      // after `{` if top-level
      sub=annoStructValue
      {
        if ($value.$flatten) $value.$flatten.push( $sub );
        else this.addDef( $sub, $value, 'struct', null, $sub.name );
      }
      ( ',' | <exitLoop> | <guard=fail, repeatLoop, restrict=Id> )
      // <guard=fail, repeatLoop>` for better error recovery for input `foo@bar`
    )*
    // TODO TOOL: allow:
    // ( <guard=arrayAnno, …> '}' | <error> )         // TODO TOOL - workaround:
    { this.ec( 'arrayAnno', 'orNotEmpty' ); } '}'
    // Do NOT use <prepare=afterBrace> here!
  |
    '['<prepare=arrayAnno>
    { $value.val = []; $value.literal = 'array' }
    // no need for createArray() here, $value.location is set above
    (
      ( sub=annoValue { $value.val.push( $sub ) }
      |
        <guard=arrayAnno, arg=ellipsis> ellipsis='...'
        ( UP TO upTo=annoValue
          { $value.val.push( { literal: 'token', val: '...', location: $ellipsis.location, upTo: $upTo } ); }
        | { $value.val.push( { literal: 'token', val: '...', location: $ellipsis.location } ); }
        )
        // TODO TOOL: if at last good state the command is ['g'],resume after the
        // gotos, do not execute its actions - ?
        // ( UP TO upTo=annoValue | { $upTo = undefined; } )
        // { $value.val.push( { literal: 'token', val: '...', location: $ellipsis.location, upTo: $upTo } ); }
      )
      ( ',' | <exitLoop> )
    )*
    // TODO TOOL: allow ( <guard=arrayAnno, arg=bracket> ']' )
    { this.ec( 'arrayAnno', 'bracket' ); }<always>
    ']'
  |
    '(' $value=condition ')' { $value.$tokenTexts = this.ruleTokensText(); }
    // TODO: (1,2,3) not supported, yet, only ((1,2,3))
  ;

// Shorten tokens array in this.gr() calls in top-level rules by reducing
// intersection follow set, see cap/redepage#97:
ignoredRule
options{ excludeRuleFrom = Parser }
  :
    usingDeclaration ';'
    artifactDefOrExtend ';'
    boundActionFunctionDef ';'
    elementDef ';'
    annotateBoundAction ';'
    annotateElement ';'
    elementDefOrExtend ';'
  ;
