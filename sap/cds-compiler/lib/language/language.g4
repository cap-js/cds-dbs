// ANTLR4 grammar to generate Parser and Lexer for CDS-Language

// To be built the parser by hand, install Java, download the ANTLR4 tool, then
//   antlr4 -no-listener -o ../gen language.g4
// Alternatively, install Java, and use
//   npm run download && npm run gen
//
// To test the parser in the REPL, see file './lib/language/antlrParser.js'.

// This grammar is built according to the following guidelines:
//
//  * Do not express every syntactical restriction by grammar rules, and do
//    not define a grammar which allows every nonsense.  We might specify
//    syntactical restrictions in a certain form inside actions or semantic
//    predicates to have them directly available for IDE code completion.
//
//  * Keep the number of token types small.  Thus, do not define different
//    token types for things which are not distinguished in the parser.
//    Examples: one token type for numbers (have a check if you just want to
//    allow integers at certain places), one token type for non-quoted and
//    quoted identifiers.
//
//  * Keep the number of keywords as small as possible.  Thus, built-ins is a
//    topic for the semantic analysis, not the grammar.  Examples: no keywords
//    for built-in types or built-in SQL functions.  This also avoids noise in
//    the grammar and a huge/slow generated parser.
//  ┌─────────────────────────────────────────────────────────────────────────┐
//    For our adapted ANTLR error strategy concerning (non-reserved) keywords,
//    make sure to define non-reserved keywords between the lexer rule `Number`
//    and `Identifier`.  The latter must be the second last rule, the last is
//    `IllegalToken`.  Do not rename these three rules.  Add each new
//    non-reserved keyword to rule `ident`, but check for ambiguities!
//  └─────────────────────────────────────────────────────────────────────────┘
//
//  * Left-factor the parser grammar if the same initial part covers more than
//    one or two tokens.  ANTLRs adaptive predication allows to write "natural"
//    rules, but slows down parsing, especially if a long lookahead is needed
//    to solve an LLk ambiguity.  Therefore, try to avoid it in rules which are
//    called often.  Unfortunately, we cannot use ANTLR3's grammar and subrule
//    option 'k' (lookahead depth) anymore...  Therefore...
//  ┌─────────────────────────────────────────────────────────────────────────┐
//    Before each alternative with LL1 ambiguities (looking at the next token
//    is not enough for a decision), write a comment starting with `#ATN:`
//    which describes the ambiguity.  Additionally, put a comment `/* #ATN n
//    */` INSIDE an (`@after`) action of a rule if the corresponding function
//    in '../gen/languageParser.js' contains `n` occurrences of
//    `adaptivePredict` calls.  This is checked in 'test/testCompiler.js',
//    which also counts the total number of `adaptivePredict` occurrences.
//  └─────────────────────────────────────────────────────────────────────────┘
//
//  * For fast parsing and lower memory consumption, we use ANTLR4 with SLL
//    prediction-mode only.  That means that ANTLR does not use the actual call
//    stack when deciding which alternative to choose in a rule.  You might
//    need to copy a rule manually to get less ambiguities - this might be a
//    good idea anyway to avoid calls to `adaptivePredict`, see the rules
//    starting with `annotationAssignment_`.
//
//  * Factoring out a sub rule into a named rule influences the error recovery:
//    the parser tries to consume all tokens which are neither in the follow
//    set of loops and named rules.  So be careful.
//
//  * Do not use actions in the lexer.  Examples: de-quote string literals not
//    in the lexer, but in the parser; do not throw errors, but produce error
//    tokens if necessary.
//
//  * Use actions in the parser to produce a Augmented CSN model.  To have it
//    also in the case of syntax errors, produce it by adding sub-nodes to a
//    parent node, not by returning the nodes (the latter is fine for secondary
//    attachments).
//
//  * Action code should be a one-liner (<100 chars); usually, just one action
//    is called per alternative (plus the @after action which sets the AST
//    location).  For more complicated code, define a method in file
//    './genericAntlrParser.js'.
//
//  * Do not write lexer rules for tokens like ';', use ';' directly in the
//    parser rule.  Advantage: better error messages; taste: more or less
//    readable grammar; disadvantage: debugging in generated code.
//
//  * Use all-upper token names for keywords (e.g. CONTEXT), capitalized ones
//    (e.g. Number) for others - EOF is the exception (is ANTLR-builtin).
//    Remember: parser rule names in ANTLR start with a lower-case letter.
//
//  * No useless parentheses in the grammar.  There are just two binary grammar
//    operators: alternative (`|`) and sequence.  It should not be too hard to
//    remember that sequence binds stronger than alternative.
//
//  * Use the following indentation rules:
//     - rule header: indentation 0 + 2* parentheses/braces depth
//     - rule colon (':' separating header & body): 2
//     - rule body: 4 + 2* parentheses/braces depth, -2 for certain chars at
//       beginning of line: '|', ')', ']' or '}'
//     - inside action: as for the action language, e.g. function argument
//       alignment
//     - rule semicolon (';' ending body, before exceptions): 2
//     - rule exceptions (not used): 2 + 2* parentheses/braces depth

// Some practical info:
//
//  * The end location for the match of a rule is just available in the @after
//    action.  Use method `attachLocation` there on the produced AST.
//
//  * Be careful with the rule names: the methods in antlr4.Parser, the methods
//    in `./antlrParser' and the parser rule names share the same namespace.
//    Any shadowing lead to an exception when running 'test/testCompiler.js'.
//
//  * Be careful with names for rule arguments, returns, locals and rule
//    reference labels: the names `parser`, `parent` and `invokingState` cannot
//    be used (these are added by the generator).
//
//  * The ANTLR error "missing attribute access on rule reference c in $c" can
//    be solved with using $ctx.c instead of $c
//
//  * If you want to set a property starting with '$' like $syntax, use
//    obj['$'+'syntax'] as the ANTLR tool would replace $syntax by $ctx.syntax
//
//  * If you want to use Unicode characters, move the corresponding code to
//    ./genericAntlrParser.js; ANTLR or the TypeScript wrapper might destroy
//    Unicode characters on certain operating systems.

grammar language;
options {
  language = JavaScript;
  superClass = genericAntlrParser;
}
tokens {
  ELEMENT,                      // used with setLocalToken()
  MASKED,                       // used with setLocalToken()
  VIRTUAL,                      // used with setLocalToken()
  OVER,                         // used with setLocalTokenIfBefore()
  HelperToken1,                 // used with setLocalToken(), does not appear in messages
  HelperToken2,                 // used with setLocalToken(), does not appear in messages
  HideAlternatives,             // hide alternative tokens (no token seq!)
  GenericExpr,                  // via token rewriting according to specialFunctions
  GenericSeparator,             // via token rewriting according to specialFunctions
  GenericIntro,                 // via token rewriting according to specialFunctions
  DOTbeforeBRACE,               // via token rewrite
  COMPOSITIONofBRACE,           // via token rewrite in rule typeAssociationBase
  SemicolonTopLevel             // used for code completion after top-level definitions
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
//  - literal values and identifiers
//  - Lexer: spaces, literal values, reserved keywords, unreserved keywords, identifier

// Top-Level -----------------------------------------------------------------

start returns [ source ] locals [ _sync = 'recover' ]
@init{ $source = this.createSource(); }
  :
    usingDeclaration[$source]*
    (
      namespaceDeclaration[$source]
      ( usingDeclaration[$source] | artifactDefOrExtend[$source] )*
    |
      artifactDefOrExtend[$source]
      ( usingDeclaration[$source] | artifactDefOrExtend[$source] )*
    )?
    { this.markAsSkippedUntilEOF(); }
    EOF
  ;

namespaceDeclaration[ source ] locals[ decl = {} ]
@after {
  $source.namespace = { kind: 'namespace', name: $decl };
  this.attachLocation( $source.namespace );
}
  :
    NAMESPACE simplePath[ $decl, 'Namespace' ] ';'
  ;

usingDeclaration[ source ] locals[ decl = {} ]
@after { this.attachLocation($decl); }
  :
    { $decl.location = this.startLocation(); }
    USING
    (
      FROM str=String
       { $source.dependencies.push( this.quotedLiteral( $str, 'string' ) ); }
    |
      usingProxy[ $source, $decl ]
      ( FROM str=String
        { $source.dependencies.push( $decl.fileDep = this.quotedLiteral( $str, 'string' ) ); }
      )?
    |
      { this.addItem( $decl, $source, 'usings', 'using' ); }
      // We could just create "independent" USING declaration, but if we want
      // to have some check in the future whether the external artifacts are
      // really in the FROM source...
      '{' { $decl.usings = this.createArray(); }
      usingProxy[ $decl, {} ]
      ( ',' { if (this.isStraightBefore("}")) break; } // allow ',' before '}'
        usingProxy[ $decl, {} ] )*
      '}' { this.finalizeDictOrArray( $decl.usings ); }
      ( FROM str=String
        { $source.dependencies.push( $decl.fileDep = this.quotedLiteral( $str, 'string' ) ); }
      )?
    )
    ';'
  ;

usingProxy[ outer, proxy ]
@after { this.attachLocation($proxy); }
  :
    { if (!$proxy.location) $proxy.location = this.startLocation();
      $proxy.extern = {}; }
    simplePath[ $proxy.extern, 'global' ]
    { this.addItem( $proxy, $outer, 'usings', 'using' ); }
    ( AS name=ident['UsingAlias'] { $proxy.name = $name.id; }
    | { this.classifyImplicitName( 'Using' ); }
    )
  ;

artifactDefOrExtend[ outer, defOnly = false ] locals[ art = new parser.XsnArtifact() ] // cannot use `parent` as parameter name!
@after{ /* #ATN 1 */ }
  :
    { $art.location = this.startLocation(); this.docComment( $art ); }
    annotationAssignment_ll1[ $art ]*
    (
      DEFINE?
      ( serviceDef[ $art, $outer, $defOnly ]
      | contextDef[ $art, $outer, $defOnly ]
      | entityDef[ $art, $outer ]
      | typeDef[ $art, $outer ]
      | aspectDef[ $art, $outer ]
      | annotationDef[ $art, $outer ]
      | viewDef[ $art, $outer ]
      | eventDef[ $art, $outer ]
      | actionFunctionMainDef[ $art, $outer ]
      )
    |
      extend=EXTEND
      { this.reportUnexpectedExtension( $defOnly, $extend );
        if (!$outer.extensions) $outer.extensions = [];
      }
      // #ATN: EXTEND art, while CONTEXT, ENTITY etc are not reserved
      ( extendService[ $art, $outer ]
      | extendContext[ $art, $outer ]
      | extendEntityOrAspect[ $art, $outer ] // or aspect
      | extendProjection[ $art, $outer ]
      | extendType[ $art, $outer ]
      // Streamlined Syntax; we won't add more kinds of the non-streamlined variants:
      | extendArtifact[ $art, $outer ]
      )
    |
      annotate=ANNOTATE
      { this.reportUnexpectedExtension( $defOnly, $annotate );
        if (!$outer.extensions) $outer.extensions = [];
        this.meltKeywordToIdentifier();
      }
      annotateArtifact[ $art, $outer ] // not kind-specific
    )
  ;

optArtifactsBlock[ art, defOnly = false ]
@after { this.attachLocation( $art ); }
  :
    (
      '{' { $art.artifacts = this.createDict(); $art.extensions = []; }
      artifactDefOrExtend[ $art, defOnly ]*
      '}' { this.finalizeDictOrArray( $art.artifacts ); this.insertSemicolon(); }
    )?
  ;

requiredSemi
  : ';'
  | { return $ctx; }            // do not actually parse the closing brace
    '}'
  ;

optionalSemi
  : { this.noAssignmentInSameLine(); } // issue warning for } @Anno \n? NextDef
    ';'?
  ;

// Annotation def and main definitions ------------------------------------------

annotationDef[ art, outer ] locals[ name = new parser.XsnName() ]
@after { this.attachLocation( $art ); }
  :
    annotation=ANNOTATION simplePath[ $name, 'AnnoDef' ]
    { if ($outer.kind !== 'source') { // this is a syntax restriction to avoid confusion
        this.error( 'syntax-unexpected-vocabulary', $annotation, { '#': $outer.kind } );
        $art = new this.XsnArtifact(); }
      else {
        if (!$outer.vocabularies) $outer.vocabularies = Object.create(null);
        this.addDef( $art, $outer, 'vocabularies', 'annotation', $name );
      }
      this.docComment( $art ); }
    annotationAssignment_fix[ $art ]*
    typeSpecSemi[ $art ] // also 'includes'...
  ;

serviceDef[ art, outer, defOnly = false ] locals[ name = new parser.XsnName(); ]
@after { this.attachLocation( $art ); }
  :
    SERVICE simplePath[ $name, 'Service' ]
    { this.addDef( $art, $outer, 'artifacts', 'service', $name ); }
    { this.docComment( $art ); }
    annotationAssignment_fix[ $art ]*
    optArtifactsBlock[ $art, defOnly ]
    ( requiredSemi | SemicolonTopLevel )
  ;

contextDef[ art, outer, defOnly = false ] locals[ name = new parser.XsnName(); ]
@after { this.attachLocation( $art ); }
  :
    CONTEXT simplePath[ $name, 'Context' ]
    { this.addDef( $art, $outer, 'artifacts', 'context', $name ); }
    { this.docComment( $art ); }
    annotationAssignment_fix[ $art ]*
    optArtifactsBlock[ $art, defOnly ]
    ( requiredSemi | SemicolonTopLevel )
  ;

eventDef[ art, outer ] locals[ name = new parser.XsnName(); ]
@after { /* #ATN 1 */ this.attachLocation( $art ); }
  :
    EVENT simplePath[ $name, 'Event' ]
    { this.addDef( $art, $outer, 'artifacts', 'event', $name );
      this.docComment( $art ); }
    annotationAssignment_fix[ $art ]*
    (
      typeStruct[ $art ] optionalSemi
    |
      ':'
      // #ATN: includeRef can be / start with PROJECTION
      (
        { $art.type = {}; }
        simplePath[ $art.type, 'artref' ]
        (
          { $art.includes = [ $art.type ]; delete $art.type; }
          ( ',' { if (this.isStraightBefore('{')) break; } // allow ',' before '{' // }}
            includeRef[ $art ]
          )*
          typeStruct[ $art ] optionalSemi
        |
          { this.docComment( $art ); }
          annotationAssignment_ll1[ $art ]*
          requiredSemi
        )
      |
        typeStruct[ $art ] optionalSemi
      |
        qp=projectionSpec
        { $art.query = $qp.query; $art['$'+'syntax'] = 'projection'; }
        requiredSemi
      )
    )
  ;

viewDef[ art, outer ] locals[ name = new parser.XsnName(); ]
@after { this.attachLocation( $art ); }
  :
    v=VIEW simplePath[ $name, 'Entity' ]
    { $art['$'+'syntax'] = 'view';
      this.addDef( $art, $outer, 'artifacts', 'entity', $name );
      this.docComment( $art ); }
    annotationAssignment_fix[ $art ]*
    (
      parameterListDef[ $art ]
    |
      // TODO: warning deprecated?
      ( HideAlternatives | WITH ) { $art.params = this.createDict(); }
      PARAMETERS
      parameterDef[ $art ]
      ( ',' parameterDef[ $art ] )* // no optional final ',' here
      { this.finalizeDictOrArray( $art.params ); }
    )?
    AS qe=queryExpression { $art.query = $qe.query; }
    // TODO check ANTLR: bad msg with 'view V as'<eof> but 'view V as FOO' is fine
    ( requiredSemi | SemicolonTopLevel )
  ;

entityDef[ art, outer ] locals[ name = new parser.XsnName() ]
@after { this.attachLocation( $art ); }
  :
    ENTITY simplePath[ $name, 'Entity' ]
    { this.addDef( $art, $outer, 'artifacts', 'entity', $name );
      this.docComment( $art ); }
    annotationAssignment_fix[ $art ]*
    parameterListDef[ $art ]?
    (
      ( ':'
        includeRef[ $art ]
        ( ',' { if (this.isStraightBefore('{')) break; } // allow ',' before '{' // }}
          includeRef[ $art ]
        )*
      )?
      '{' { $art.elements = this.createDict(); }
      elementDef[ $art ]*
      '}' { this.finalizeDictOrArray( $art.elements ); this.insertSemicolon(); }
      (
        ACTIONS '{' { $art.actions = this.createDict(); }
        actionFunctionDef[ $art ]*
        '}' { this.finalizeDictOrArray( $art.actions ); this.insertSemicolon(); }
      )?
      ( requiredSemi | SemicolonTopLevel )
    |
      AS
      ( qe=queryExpression
        { $art.query = $qe.query; $art['$'+'syntax'] = 'entity' }
        (
          ACTIONS '{' { $art.actions = this.createDict(); }
          actionFunctionDef[ $art ]*
          '}' { this.finalizeDictOrArray( $art.actions ); this.insertSemicolon(); }
        )?
        ( requiredSemi | SemicolonTopLevel )
      | qp=projectionSpec
        { $art.query = $qp.query; $art['$'+'syntax'] = 'projection'; }
        projectionClauses[ $qp.query ]
        (
          ACTIONS '{' { $art.actions = this.createDict(); }
          actionFunctionDef[ $art ]*
          '}' { this.finalizeDictOrArray( $art.actions ); this.insertSemicolon(); }
        )?
        { this.reportMissingSemicolon(); }
        optionalSemi         // TODO: not fully correct without columns or excluding
      )
    )
  ;

aspectDef[ art, outer ] locals[ name = new parser.XsnName() ]
@after { this.attachLocation( $art ); }
  :
    ( ASPECT | ( abs=ABSTRACT | HideAlternatives ) ent=ENTITY )
    simplePath[ $name, 'Type' ]
    { this.addDef( $art, $outer, 'artifacts', 'aspect', $name );
      if ($ent)
        this.warning( 'syntax-deprecated-abstract', this.tokenLocation( $abs, $ent ) );
      this.docComment( $art ); }
    annotationAssignment_fix[ $art ]*
    ( ':'
      (
        includeRef[ $art ]
        ( ',' { if (this.isStraightBefore('{')) break; } // allow ',' before '{' // }}
          includeRef[ $art ]
        )*
        elementsAndOptActions[ $art ]?
      |
        elementsAndOptActions[ $art ]
      )
    |
      elementsAndOptActions[ $art ]
    )?
    ( requiredSemi | SemicolonTopLevel )
  ;

elementsAndOptActions[ art ]
  :
    '{' { $art.elements = this.createDict(); }
    ( elementDef[ $art ]* )
    '}' { this.finalizeDictOrArray( $art.elements ); this.insertSemicolon(); }
    (
      ACTIONS '{' { $art.actions = this.createDict(); }
      actionFunctionDef[ $art ]*
      '}' { this.finalizeDictOrArray( $art.actions ); this.insertSemicolon(); }
    )?
  ;

typeDef[ art, outer ] locals[ name = new parser.XsnName() ]
@after { this.attachLocation( $art ); }
  :
    TYPE simplePath[ $name, 'Type' ]
    { this.addDef( $art, $outer, 'artifacts', 'type', $name );
      this.docComment( $art ); }
    annotationAssignment_fix[ $art ]*
    typeSpecSemi[ $art ]
  ;

actionFunctionMainDef[ art, outer ] locals[ name = new parser.XsnName() ]
@after { this.attachLocation( $art ); }
  :
  (
    ACTION simplePath[ $name, 'Action' ]
    { this.addDef( $art, $outer, 'artifacts', 'action', $name );
      this.docComment( $art ); }
    annotationAssignment_fix[ $art ]*
    parameterListDef[ $art ]
    returnTypeSpec[ $art ]?
  |
    FUNCTION simplePath[ $name, 'Action' ]
    { this.addDef( $art, $outer, 'artifacts', 'function', $name );
      this.docComment( $art ); }
    annotationAssignment_fix[ $art ]*
    parameterListDef[ $art ]
    returnTypeSpec[ $art ]
  )
  ( requiredSemi | SemicolonTopLevel )
  ;

// Member definitions: actions, elements, enums, parameters: --------------------

actionFunctionDef[ outer ] locals[ art = new parser.XsnArtifact() ]
@after { this.attachLocation( $art ); }
  :
    { $art.location = this.startLocation();; this.docComment( $art ); }
    annotationAssignment_ll1[ $art ]*
    (
      ACTION name=ident['BoundAction']
      { this.addDef( $art, $outer, 'actions', 'action', $name.id );
        this.docComment( $art ); }
      annotationAssignment_fix[ $art ]*
      parameterListDef[ $art ]
      returnTypeSpec[ $art ]?
    |
      FUNCTION name=ident['BoundAction']
      { this.addDef( $art, $outer, 'actions', 'function', $name.id );
        this.docComment( $art ); }
      annotationAssignment_fix[ $art ]*
      parameterListDef[ $art ]
      returnTypeSpec[ $art ]
    )
    requiredSemi
  ;

parameterDef[ outer ] locals[ art = new parser.XsnArtifact() ]
@after { this.attachLocation( $art ); }
  :
    { this.meltKeywordToIdentifier();; this.docComment( $art ); }
    ( annotationAssignment_ll1[ $art ]
      { this.meltKeywordToIdentifier(); }
    )*
    name=ident['Param']
    { this.addDef( $art, $outer, 'params', 'param', $name.id );
      this.docComment( $art ); }
    annotationAssignment_fix[ $art ]*
    typeSpec[ $art ]
    // TODO: the following is critical (not after elements/enum and various
    // others)
    (
      { if ($art.items) this.message( 'syntax-unexpected-after', this.getCurrentToken(), { '#': 'many', keyword: 'default' } ); }
      defaultValue[ $art ]
    )?
    { if (this.getCurrentToken().text === '@' && ($art.enum || $art.items?.enum))
      this.message( 'syntax-unexpected-after', this.getCurrentToken(), { '#': 'enum' } ); }
    { this.docComment( $art ); }
    annotationAssignment_ll1[ $art ]*
  ;

parameterListDef[ art ]
  :
    '(' { $art.params = this.createDict(); }
    // also empty param list (we might do some hacking later to allow reserved words)
    // see annotationAssignment_paren
    {
      if (this.isStraightBefore(')')) {
        this.matchWildcard();   // we know it is the ')' - we do not reach the final match
        this.finalizeDictOrArray( $art.params );
        return $ctx;
      }
    }
    parameterDef[ $art ]
    ( ',' { if (this.isStraightBefore(')')) break; } // allow ',' before ')'
      parameterDef[ $art ]
    )*
    ')' { this.finalizeDictOrArray( $art.params ); }
  ;

enumSymbolDef[ outer ] locals[ art = new parser.XsnArtifact() ]
@after { this.attachLocation( $art ); }
  :
    { $art.location = this.startLocation();; this.docComment( $art ); }
    annotationAssignment_ll1[ $art ]*
    name=ident['Enum']
    { this.addDef( $art, $outer, 'enum', 'enum', $name.id );
      this.docComment( $art ); }
    annotationAssignment_ll1[ $art ]*
    ( '='
      { this.excludeExpected( ['Boolean', 'QuotedLiteral', "'#'", 'NULL'] ); }
      (
        val=literalValue
        { $art.value = $val.val; }
      |
        ( plus='+' | min='-' )
        Number
        { $art.value = this.numberLiteral( $plus||$min ); }
      )
      { this.docComment( $art ); }
      annotationAssignment_ll1[ $art ]*
    )?
    requiredSemi
  ;

elementDef[ outer ] locals[ $art = new parser.XsnArtifact() ]
  :
    { $art.location = this.startLocation();; this.docComment( $art ); }
    annotationAssignment_ll1[ $art ]*
    elementDefInner[ $art, $outer ]
  ;

elementDefInner[ art, outer, explicitElement = false ]
@after{ this.attachLocation( $art ); }
  :
    // VIRTUAL is keyword, except if before the following tokens texts:
    { this.setLocalToken( 'VIRTUAL', 'VIRTUAL', /^[;:{@=}]$/ ); }
    ( virtual=VIRTUAL { $art.virtual = this.valueWithTokenLocation( true, $virtual ); } )?
    ( key=KEY { $art.key = this.valueWithTokenLocation( true, $key ); } )?
    { this.setLocalToken( 'MASKED', 'MASKED', /^[;:{@=}]$/ ); }
    ( masked=MASKED
      {
        $art.masked = this.valueWithTokenLocation( true, $masked ) ;
        this.message( 'syntax-unsupported-masked', $masked, { keyword: 'masked' } );
      }
    )?
    { this.setLocalToken( 'ELEMENT', 'ELEMENT', /^[;:{@=}]$/ ); }
    ( ELEMENT { $explicitElement = true; } )? // auto-recognizable at other places
    name=ident['Element']
    { this.addDef( $art, $outer, 'elements', 'element', $name.id );
      this.docComment( $art ); }
    annotationAssignment_fix[ $art ]*
    (
      typeStruct[ $art ]
      ( nullability[ $art ]
        requiredSemi
      | optionalSemi            // NOT and NULL are reserved...
      )
    |
      ':'
      elementType[ $art ]
    |
      eq='=' e=expression       // SQL has syntax variant using AS - we DO NOT
      stored=STORED?
      { $art.value = $e.expr;
        // this.setIntroLocation( eq );  -- future
        if ($stored)
          $art.value.stored = this.valueWithTokenLocation( true, $stored );
        if ($explicitElement)
          $art['$'+'syntax'] = 'element';
      }
      { this.docComment( $art ); }
      annotationAssignment_ll1[ $art ]* // for enum symbol def via EXTEND
      requiredSemi
    |
      requiredSemi
    )
  ;

// Called by `elementDefInner`:
elementType[ art ] locals[ tokenAtAnnoPos ] // TODO: split this monster rule
@after{ /* #ATN 3 */ this.attachLocation( $art ); }
  :
    // #ATN: referenced type name can be ASSOCIATION or ARRAY or TYPE or LOCALIZED
    typeStruct[ $art ]
    nullability[ $art ]?
    requiredSemi
  |
    typeAssociationBase[ $art, true ]
    // #ATN: path could start with MANY or ONE - make sure a token follows in same rule!
    (
      typeStruct[ $art.target, true ] optionalSemi
    |
      one=ONE
      { this.setMaxCardinality( $art, { literal: 'number', val: 1 }, $one ); }
      typeCompoStruct[ $art.target ] optionalSemi
    |
      many=MANY
      { this.setMaxCardinality( $art, { literal: 'string', val: '*' }, $many ); }
      typeCompoStruct[ $art.target ] optionalSemi
    |
      // we do not support `Composition of many { e }` - ambiguity ad-hoc target versus foreign keys!
      typeToMany[ $art ] typeAssociationElementCont[ $art ]
    |
      typeToOne[ $art ] typeAssociationElementCont[ $art ]
    |
      simplePath[ $art.target, 'artref' ] typeAssociationElementCont[ $art ]
    )
  |
    (
      array=ARRAY of=OF
      { $art.items = { location: this.tokenLocation( $array, $of ) }; }
    | many=MANY
      { $art.items = { location: this.tokenLocation( $many ) };}
    )
    ( typeStruct[ $art.items ]
      nullability[ $art.items ]?
    | // #ATN: typeRefOptArgs/typeTypeOf can start with TYPE
      ( typeTypeOf[ $art.items ] | typeRefOptArgs[ $art.items ] )
      nullability[ $art.items ]?
      { $tokenAtAnnoPos = this.getCurrentToken();; this.docComment( $art ); }
      annotationAssignment_ll1[ $art ]*
      (
        { if ($tokenAtAnnoPos !== this.getCurrentToken()) this.message( 'syntax-unexpected-after', this.getCurrentToken(), { keyword: this.getCurrentToken().text } ); }
        ENUM '{' { $art.items.enum = this.createDict(); }
        enumSymbolDef[ $art.items ]*
        '}' { this.finalizeDictOrArray( $art.items.enum ); }
        nullability[ $art.items ]?
      )?
    )
    requiredSemi                     // also req after struct/enum
  |
    l=LOCALIZED { $art.localized = this.valueWithTokenLocation( true, $l ); }
    typeRefOptArgs[ $art ]
    optInvisibleNullability[ $art ]
    { $tokenAtAnnoPos = this.getCurrentToken();; this.docComment( $art ); }
    annotationAssignment_ll1[ $art ]*
    (
      { if ($tokenAtAnnoPos !== this.getCurrentToken()) this.message( 'syntax-unexpected-after', this.getCurrentToken(), { keyword: this.getCurrentToken().text } ); }
      elementProperties[ $art ]
      { this.docComment( $art ); }
      annotationAssignment_ll1[ $art ]*
    )?
    requiredSemi
  |
    typeTypeOf[ $art ] // Note: Same as the typeRefOptArgs rule below
    optInvisibleNullability[ $art ]
    { $tokenAtAnnoPos = this.getCurrentToken();; this.docComment( $art ); }
    annotationAssignment_ll1[ $art ]*
    (
      ENUM '{' { $art.enum = this.createDict(); }
      enumSymbolDef[ $art ]*
      '}' { this.finalizeDictOrArray( $art.enum ); }
      elementProperties[ $art ]?
    |
      { if ($tokenAtAnnoPos !== this.getCurrentToken()) this.message( 'syntax-unexpected-after', this.getCurrentToken(), { keyword: this.getCurrentToken().text } ); }
      elementProperties[ $art ]
      { this.docComment( $art ); }
      annotationAssignment_ll1[ $art ]*
    )?
    requiredSemi                     // also req after foreign key spec
  |
    typeRefOptArgs[ $art ] // Note: Same as the typeTypeOf rule above
    optInvisibleNullability[ $art ]
    { $tokenAtAnnoPos = this.getCurrentToken();; this.docComment( $art ); }
    annotationAssignment_ll1[ $art ]*
    (
      ENUM '{' { $art.enum = this.createDict(); }
      enumSymbolDef[ $art ]*
      '}' { this.finalizeDictOrArray( $art.enum ); }
      elementProperties[ $art ]?
    |
      { if ($tokenAtAnnoPos !== this.getCurrentToken()) this.message( 'syntax-unexpected-after', this.getCurrentToken(), { keyword: this.getCurrentToken().text } ); }
      elementProperties[ $art ]
      { this.docComment( $art ); }
      annotationAssignment_ll1[ $art ]*
    )?
    requiredSemi                     // also req after enum spec
  ;

elementProperties[ elem ]
  :
    defaultAndNullability[ $elem ]
  |
    '=' e=expression
    stored=STORED?
    { $elem.value = $e.expr;
      if ($stored)
        $elem.value.stored = this.valueWithTokenLocation( true, $stored );
    }
  ;

defaultAndNullability[ elem ]
  :
    defaultValue[ $elem ]
    nullability[ $elem ]?       // placement accoring to SQL spec
  |
    nullability[ $elem ]
    defaultValue[ $elem ]?
  ;

defaultValue[ art ] locals[ elem, elements = {} ]
  :
  // TODO: We may support structured default values here.
  DEFAULT expr=expression { $art.default = $expr.expr; }
  ;

// Extend and annotate ----------------------------------------------------------

extendArtifact[ art, outer ] locals[ name = new parser.XsnName(), elemName = new parser.XsnName() ]
@after{ /* #ATN 1 */ this.attachLocation( $art ); }
  :
    simplePath[ $name, 'Ext' ]
    (
      ':' simplePath[ $elemName, 'ExtElement']
      { this.addExtension( $art, $outer, 'extend', $name, $elemName.path ); }
      extendWithOptElementsOrType[ art ]
    |
      { this.addExtension( $art, $outer, 'extend', $name ); }
      extendWithOptElementsNoWith[ art ]
    |
      { this.addExtension( $art, $outer, 'extend', $name ); }
      WITH { this.noSemicolonHere(); }
      { this.docComment( $art ); }
      annotationAssignment_ll1[ $art ]*
      // #ATN: ELEMENTS, ENUM, DEFINITIONS, COLUMNS, ACTIONS are not reserved and
      // could be includeRef
      (
        // all the alternatives from `extendWithOptElementsOrType` --------------
        '{' { $art.elements = this.createDict(); }
        elementDefOrExtend[ $art ]*
        '}' { this.finalizeDictOrArray( $art.elements ); }
        { this.checkExtensionDict( $art.elements ); }
        { this.insertSemicolon(); }
      |
        ELEMENTS { $art.elements = this.createDict(); } '{'
        elementDefOrExtend[ $art, true ]*
        '}' { this.finalizeDictOrArray( $art.elements ); }
        { this.checkExtensionDict( $art.elements ); }
        { this.insertSemicolon(); }
      |
        ENUM { $art.enum = this.createDict(); } '{'
        enumSymbolDef[ $art ]*  // TODO: no EXTEND in enum? (ok, would just allow annos)
        '}' { this.finalizeDictOrArray( $art.enum ); this.insertSemicolon(); }
      |
        // extend Art with (length: 10);
        // `with` is required, or we could have `extend String(length:10);`.
        // future `extend Action with (param: Type)` now has ambiguity
        typeNamedArgList[ $art ]
      |
        // extension alternatives for main definitions --------------------------
        includeRef[ $art ] ( ',' includeRef[ $art ] )*
      |
        DEFINITIONS { $art.artifacts = this.createDict(); } '{'
        artifactDefOrExtend[ $art, 'definitions' ]*
        '}' { this.finalizeDictOrArray( $art.artifacts ); this.insertSemicolon(); }
      |
        COLUMNS { $art.columns = this.createArray(); } '{'
        (
          selectItemDef[ $art.columns ]
          ( ',' { if (this.isStraightBefore("}")) break; } // allow ',' before '}'
            selectItemDef[ $art.columns ]
          )*
        )?
        '}' { this.finalizeDictOrArray( $art.columns ); this.insertSemicolon(); }
      |
        ACTIONS { $art.actions = this.createDict(); } '{'
        actionFunctionDef[ $art ]* // TODO: no EXTEND in actions? (ok, would just allow annos)
        '}' { this.finalizeDictOrArray( $art.actions ); this.insertSemicolon(); }
      )?
      ( requiredSemi | SemicolonTopLevel )
    )
  ;

extendService[ art, outer ] locals[ name = new parser.XsnName() ]
@after { this.attachLocation( $art ); }
  :
    SERVICE { $art.expectedKind = this.valueWithTokenLocation(); }
    simplePath[ $name, 'ExtService' ]
    { $art.name = $name; this.addItem( $art, $outer, 'extensions', 'extend' ); }
    ( WITH { this.noSemicolonHere(); } )?
    { this.docComment( $art ); }
    annotationAssignment_fix[ $art ]*
    optArtifactsBlock[ art, 'service' ]
    ( requiredSemi | SemicolonTopLevel )
  ;

extendContext[ art, outer ] locals[ name = new parser.XsnName() ]
@after { this.attachLocation( $art ); }
  :
    CONTEXT { $art.expectedKind = this.valueWithTokenLocation(); }
    simplePath[ $name, 'ExtContext' ]
    { $art.name = $name; this.addItem( $art, $outer, 'extensions', 'extend' ); }
    ( WITH { this.noSemicolonHere(); } )?
    { this.docComment( $art ); }
    annotationAssignment_fix[ $art ]*
    optArtifactsBlock[ art, 'context' ]
    ( requiredSemi | SemicolonTopLevel )
  ;

extendEntityOrAspect[ art, outer ] locals[ name = new parser.XsnName() ]
@after { /* #ATN 1 */ this.attachLocation( $art ); }
  :
    (ASPECT | ENTITY) { $art.expectedKind = this.valueWithTokenLocation(); }
    simplePath[ $name, 'Ext' ]
    { $art.name = $name;
      this.addItem( $art, $outer, 'extensions', 'extend' );
    }
    (
      WITH { this.noSemicolonHere(); this.docComment( $art ); }
      annotationAssignment_ll1[ $art ]*
      // ATN: the ref can start with ACTIONS
      (
        includeRef[ $art ] ( ',' includeRef[ $art ] )*
      |
        extendForEntity[ $art ]
      )
    |
      { this.docComment( $art ); }
      annotationAssignment_ll1[ $art ]*
      extendForEntity[ $art ]
    )
    (requiredSemi | SemicolonTopLevel )
  ;

extendForEntity[ art ]
  :
    (
      '{' { $art.elements = this.createDict(); }
      elementDefOrExtend[ $art ]*
      '}' { this.finalizeDictOrArray( $art.elements );
            this.checkExtensionDict( $art.elements );
            this.insertSemicolon();
      }
      (
        ACTIONS { $art.actions = this.createDict(); } '{'
        actionFunctionDef[ $art ]*
        '}' { this.finalizeDictOrArray( $art.actions ); this.insertSemicolon(); }
      )?
    |
      ACTIONS { $art.actions = this.createDict(); } '{'
      actionFunctionDef[ $art ]*
      '}' { this.finalizeDictOrArray( $art.actions ); this.insertSemicolon(); }
    )?
  ;

extendProjection[ art, outer ] locals[ name = new parser.XsnName() ]
@after { this.attachLocation( $art ); }
  :
    PROJECTION { $art.expectedKind = this.valueWithTokenLocation( 'entity' ); }
    simplePath[ $name, 'Ext' ]
    { $art.name = $name;
      this.addItem( $art, $outer, 'extensions', 'extend' );
    }
    ( WITH { this.noSemicolonHere(); } )?
    { this.docComment( $art ); }
    annotationAssignment_ll1[ $art ]*
    (
      '{' { $art.columns = this.createArray(); }
      (
        selectItemDef[ $art.columns ]
        ( ',' { if (this.isStraightBefore("}")) break; } // allow ',' before '}'
          selectItemDef[ $art.columns ]
        )*
      )?
      '}' { this.finalizeDictOrArray( $art.columns ); this.insertSemicolon(); }
      (
        ACTIONS { $art.actions = this.createDict(); } '{'
        actionFunctionDef[ $art ]*
        '}' { this.finalizeDictOrArray( $art.actions ); this.insertSemicolon(); }
      )?
    |
      ACTIONS { $art.actions = this.createDict(); } '{'
      actionFunctionDef[ $art ]*
      '}' { this.finalizeDictOrArray( $art.actions ); this.insertSemicolon();}
    )?
    ( requiredSemi | SemicolonTopLevel )
  ;

extendType[ art, outer ] locals[ name = new parser.XsnName() ]
@after { this.attachLocation( $art ); }
  :
    TYPE { $art.expectedKind = this.valueWithTokenLocation(); }
    simplePath[ $name, 'Ext' ]
    { $art.name = $name;
      this.addItem( $art, $outer, 'extensions', 'extend' );
    }
    // extendWithOptElementsOrType + includeRef:
    (
      extendWithOptElementsNoWith[ art ]
    |
      WITH { this.noSemicolonHere(); this.docComment( $art ); }
      annotationAssignment_ll1[ $art ]*
      (
        '{' { $art.elements = this.createDict(); }
        elementDefOrExtend[ $art ]*
        '}' { this.finalizeDictOrArray( $art.elements ); }
        { this.checkExtensionDict( $art.elements ); }
        { this.insertSemicolon(); }
      |
        // extend type Art with (length: 10);
        typeNamedArgList[ $art ]
      |
        includeRef[ $art ] ( ',' includeRef[ $art ] )*
      )?
      ( requiredSemi | SemicolonTopLevel )
    )
  ;

extendWithOptElementsOrType[ art ]
  :
    extendWithOptElementsNoWith[ art ]
  |
    WITH { this.noSemicolonHere(); this.docComment( $art ); }
    annotationAssignment_ll1[ $art ]*
    (
      '{' { $art.elements = this.createDict(); }
      elementDefOrExtend[ $art ]*
      '}' { this.finalizeDictOrArray( $art.elements ); }
      { this.checkExtensionDict( $art.elements ); }
      { this.insertSemicolon(); }
    |
      ELEMENTS { $art.elements = this.createDict(); } '{'
      elementDefOrExtend[ $art, true ]*
      '}' { this.finalizeDictOrArray( $art.elements ); }
      { this.checkExtensionDict( $art.elements ); }
      { this.insertSemicolon(); }
    |
      ENUM { $art.enum = this.createDict(); } '{'
      enumSymbolDef[ $art ]*  // TODO: no EXTEND in enum? (ok, would just allow annos)
      '}' { this.finalizeDictOrArray( $art.enum ); this.insertSemicolon(); }
    |
      // extend type|element Art with (length: 10);
      typeNamedArgList[ $art ]
    )?
    requiredSemi
  ;

extendWithOptElementsNoWith[ art ]
  :
    { this.docComment( $art ); }
    annotationAssignment_ll1[ $art ]*
    (
      '{' { $art.elements = this.createDict(); }
      elementDefOrExtend[ $art ]*
      '}' { this.finalizeDictOrArray( $art.elements ); }
      { this.checkExtensionDict( $art.elements ); }
      { this.insertSemicolon(); }
    )?
    requiredSemi
  ;

// For `extend … with elements` or `extend entity … with`, `extend aspect … with`,
// i.e. definitions in { … } are never enums
elementDefOrExtend[ outer, explicitElement = false ] locals[ art = new parser.XsnArtifact() ]
@after { /* #ATN 1 */ }  // if ($art) this.attachLocation( $art ); }
  :
    { $art.location = this.startLocation();; this.docComment( $art ); }
    annotationAssignment_ll1[ $art ]*
    // #ATN: element name for definition can be EXTEND
    (
      EXTEND
      extendElement[ $art, $outer ]
    |
      elementDefInner[ $art, $outer, $explicitElement ]
    )
  ;

extendElement[ art, outer ]
@after{ this.attachLocation( $art ); }
  :
    { this.setLocalToken( 'ELEMENT', 'ELEMENT', /^([:{@=}()]|WITH)$/i ); }
    ( ELEMENT { $art.expectedKind = this.valueWithTokenLocation(); } )?
    name=ident['ExtElement']
    { this.addDef( $art, $outer, 'elements', 'extend', $name.id ); }
    extendWithOptElementsOrType[ $art, $art ]
  ;

annotateArtifact[ art, outer ] locals[ name = new parser.XsnName(), elemName = new parser.XsnName() ]
@after { this.attachLocation( $art ); }
  :
    simplePath[ $name, 'Ext' ]
    ( // Element annotation
      ':' simplePath[ $elemName, 'ExtElement']
      { this.addExtension( $art, $outer, 'annotate', $name, $elemName.path ); }
      ( WITH { this.noSemicolonHere(); } )?
      { this.docComment( $art ); }
      annotationAssignment_ll1[ $art ]*
      ( annotateArtifactElements[ $art ]
        optionalSemi
      | requiredSemi
      )
    | // Definition annotation
      { this.addExtension( $art, $outer, 'annotate', $name ); }
      ( WITH { this.noSemicolonHere(); } )?
      { this.docComment( $art ); }
      annotationAssignment_ll1[ $art ]*
      (
        annotateArtifactElements[ $art ]
        annotateArtifactActions[ $art ]?
        optionalSemi
      |
        annotateArtifactActions[ $art ]
        optionalSemi
      |
        '(' { $art.params = this.createDict(); }
        annotateParam[ $art ]
        ( ',' { if (this.isStraightBefore(')')) break; } // allow ',' before ')'
          annotateParam[ $art ]
        )*
        ')' { this.finalizeDictOrArray( $art.params ); }
        { this.checkExtensionDict( $art.params ); }
        ( annotateArtifactElements[ $art ]
          annotateArtifactActions[ $art ]?
          optionalSemi
        | annotateArtifactActions[ $art ]
          optionalSemi
        | annotateReturns[ $art ]
        | requiredSemi
        )
      |
        annotateReturns[ $art ]
      |
        requiredSemi
      )
    )
  ;

annotateArtifactActions[ art ]
  :
    ACTIONS { $art.actions = this.createDict(); } '{'
    annotateAction[ $art ]*
    '}' { this.finalizeDictOrArray( $art.actions ); }
    { this.checkExtensionDict( $art.actions ); }
  ;

annotateArtifactElements[ art ]
  :
    '{' { $art.elements = this.createDict(); }
    annotateElement[ $art ]*
    '}' { this.finalizeDictOrArray( $art.elements ); }
    { this.checkExtensionDict( $art.elements ); }
  ;

annotateElement[ outer ] locals[ art = new parser.XsnArtifact() ]
@after{ this.attachLocation( $art ); }
  :
    { $art.location = this.startLocation();; this.docComment( $art ); }
    annotationAssignment_ll1[ $art ]*
    name=ident['ExtElement']
    { this.addDef( $art, $outer, 'elements', 'annotate', $name.id );
      this.docComment( $art ); }
    annotationAssignment_ll1[ $art ]*
    (
      '{' { $art.elements = this.createDict(); }
      annotateElement[ $art ]*
      '}' { this.finalizeDictOrArray( $art.elements ); }
      { this.checkExtensionDict( $art.elements ); }
      optionalSemi
    |
      requiredSemi
    )
  ;

annotateAction [ outer ] locals [ art = new parser.XsnArtifact() ]
@after{ this.attachLocation( $art ); }
  :
    { $art.location = this.startLocation();; this.docComment( $art ); }
    annotationAssignment_ll1[ $art ]*
    name=ident['ExtBoundAction']
    { this.addDef( $art, $outer, 'actions', 'annotate', $name.id );
      this.docComment( $art ); }
    annotationAssignment_ll1[ $art ]*
    (
      '(' { $art.params = this.createDict(); }
      annotateParam[ $art ]
      ( ',' { if (this.isStraightBefore(')')) break; } // allow ',' before ')'
        annotateParam[ $art ]
      )*
      ')' { this.finalizeDictOrArray( $art.params ); }
      { this.checkExtensionDict( $art.params ); }
    )?
    (
      annotateReturns[ $art ]
    |
      requiredSemi
    )
  ;

annotateReturns[ art ]
@after{ this.attachLocation( $art.returns ); }
  :
    ret=RETURNS { $art.returns = { location: this.tokenLocation( $ret ), kind: 'annotate' };
                  $art.returns.location.tokenIndex = $ctx.ret.tokenIndex; }
    { this.docComment( $art.returns ); }
    annotationAssignment_ll1[ $art.returns ]*
    ( '{' { $art.returns.elements = this.createDict(); }
      annotateElement[ $art.returns ]*
      '}' { this.finalizeDictOrArray( $art.returns.elements ); }
      { this.checkExtensionDict( $art.returns.elements ); }
      optionalSemi
    | requiredSemi
    )
  ;

annotateParam [ outer ] locals [ art = new parser.XsnArtifact() ]
@after{ this.attachLocation( $art ); }
  :
    { $art.location = this.startLocation();; this.docComment( $art ); }
    annotationAssignment_ll1[ $art ]*
    param=ident['ExtParam']
    { this.addDef( $art, $outer, 'params', 'annotate', $param.id );
      this.docComment( $art ); }
    annotationAssignment_ll1[ $art ]*
  ;

// Type expressions -------------------------------------------------------------

includeRef[ art ] locals[ incl = {} ]
  :
    simplePath[ $incl, 'artref' ]
    { $art.includes ??= []; $art.includes.push($incl); }
  ;

typeSpec[ art ]                 // for parameterDef
  :
    typeStruct[ $art ]
  |
    ':'
    typeSpecCont[ $art ]
  ;

returnTypeSpec[ art ]
  :
    ret=RETURNS
    { $art.returns = { location: this.tokenLocation( $ret ), kind: 'param' };
      $art.returns.location.tokenIndex = $ctx.ret.tokenIndex; }
    { this.docComment( $art.returns ); }
    annotationAssignment_ll1[ $art.returns ]*
    typeSpecCont[ $art.returns ]
  ;


// For parameters and `returns`:
typeSpecCont[ art ]
@after{ /* #ATN 1 */ }
  :
    // #ATN: typeSimple can start with ARRAY or TYPE
    ( typeStruct[ $art ]
      nullability[ $art ]?
    | typeArray[ $art ] // nullability is set in typeArray
    | typeTypeOf[ $art ]
      nullability[ $art ]?
      (
        ENUM '{' { $art.enum = this.createDict(); }
        enumSymbolDef[ $art ]*
        '}' { this.finalizeDictOrArray( $art.enum ); this.insertSemicolon(); }
        nullability[ $art ]?
      )?
      // TODO: no LOCALIZED ?
    | typeRefOptArgs[ $art ]
      nullability[ $art ]?
      (
        ENUM '{' { $art.enum = this.createDict(); }
        enumSymbolDef[ $art ]*
        '}' { this.finalizeDictOrArray( $art.enum ); this.insertSemicolon(); }
        nullability[ $art ]?
      )?
    )
  ;


// Called by `typeDef` and `annotationDef`:
typeSpecSemi[ art ] locals[ tokenAtAnnoPos ] // with 'includes', for type and annotation defs
@after{ /* #ATN 3 */ }
  :
    typeStruct[ $art ]
    ( nullability[ $art ]
      requiredSemi
    | optionalSemi
    )
  |
    ':'
    // #ATN: typeRefOptArgs can start with ARRAY or MANY or ASSOCIATION or TYPE or LOCALIZED
    // Nevertheless, MANY '{' is handled by local token rewrite:
    { this.setLocalToken( 'MANY', 'HelperToken1', /^[^\{]/ ); }
    (
      typeStruct[ $art ]
      ( nullability[ $art ]
        requiredSemi
      | optionalSemi
      )
    |
      typeAssociationBase[ $art, false ]
      // #ATN: path could start with MANY or ONE - make sure a token follows in same rule!
      ( typeToMany[ $art ]
      | typeToOne[ $art ]
      | simplePath[ $art.target, 'artref' ]
        { if (this.getCurrentToken().text === '{' && $art.type.path[0]?.id === 'cds.Composition') this.reportPathNamedManyOrOne( $art.target ); }
      )
      typeAssociationCont[ $art ]?
      requiredSemi                       // and if its the ';'...
    |
      many=HelperToken1         // rewritten MANY before '{'
      { $art.items = { location: this.tokenLocation( $many ) };}
      typeStruct[ $art.items ]
      ( nullability[ $art.items ]
        requiredSemi
      | optionalSemi
      )
    |
      (
        array=ARRAY of=OF
        { $art.items = { location: this.tokenLocation( $array, $of ) }; }
      | many=MANY
        { $art.items = { location: this.tokenLocation( $many ) };}
      )
      // #ATN: typeRefOptArgs can start with TYPE
      ( typeStruct[ $art.items ]
        ( nullability[ $art.items ]
          requiredSemi
        | optionalSemi
        )
      | ( typeTypeOf[ $art.items ] | typeRefOptArgs[ $art.items ] )
        nullability[ $art.items ]?
        { $tokenAtAnnoPos = this.getCurrentToken();; this.docComment( $art ); }
        annotationAssignment_ll1[ $art ]*
        (
          { if ($tokenAtAnnoPos !== this.getCurrentToken()) this.message( 'syntax-unexpected-after', this.getCurrentToken(), { keyword: this.getCurrentToken().text } ); }
          ENUM '{' { $art.items.enum = this.createDict(); }
          enumSymbolDef[ $art.items ]*
          '}' { this.finalizeDictOrArray( $art.items.enum ); this.insertSemicolon(); }
          nullability[ $art.items ]?
        )?
        requiredSemi
      )
    |
      typeTypeOf[ $art ]
      defaultAndNullability[ $art ]?
      { this.docComment( $art ); }
      annotationAssignment_ll1[ $art ]*
      requiredSemi
    |
      l=LOCALIZED { $art.localized = this.valueWithTokenLocation( true, $l ); }
      typeRefOptArgs[ $art ]
      defaultAndNullability[ $art ]?
      { this.docComment( $art ); }
      annotationAssignment_ll1[ $art ]*
      requiredSemi
    |
      // alt lookahead includes MANY '{'
      { $art.type = {}; }
      // Can't use typeRefOptArgs because of clash with include rule below (ATN would change)
      simplePath[ $art.type, 'artref' ]
      (
        ( typeRefArgs[ $art ]
        | ':' // with element, e.g. `type T : E:elem enum { ... }`
          { $art.type.scope = $art.type.path.length; }
          simplePath[ $art.type, 'ref']
        )?
        optInvisibleNullability[ $art ]
        { $tokenAtAnnoPos = this.getCurrentToken();; this.docComment( $art ); }
        annotationAssignment_ll1[ $art ]*
        (
          ENUM '{' { $art.enum = this.createDict(); }
          enumSymbolDef[ $art ]*
          '}' { this.finalizeDictOrArray( $art.enum ); this.insertSemicolon(); }
          defaultAndNullability[ $art ]?
        |
          { if ($tokenAtAnnoPos !== this.getCurrentToken()) this.message( 'syntax-unexpected-after', this.getCurrentToken(), { keyword: this.getCurrentToken().text } ); }
          defaultAndNullability[ $art ]
        )?
        requiredSemi
      |
        // TODO: complain if used in anno def?
        { $art.includes = [ $art.type ]; delete $art.type; }
        ( ',' { if (this.isStraightBefore('{')) break; } // allow ',' before '{' // }}
          includeRef[ $art ]
        )*
        typeStruct[ $art ]
        ( optionalSemi
        | nullability[ $art ]
          requiredSemi
        )
      )
    )
  ;

typeStruct[ art, attachLoc = false ]
@after { if ($attachLoc) this.attachLocation($art); }
  :
    '{' { $art.elements = this.createDict(); }
    elementDef[ $art ]*
    '}' { this.finalizeDictOrArray( $art.elements ); }
  ;

typeCompoStruct[ art ]
@after { this.attachLocation($art); }
  :
    COMPOSITIONofBRACE { $art.elements = this.createDict(); }
    elementDef[ $art ]*
    '}' { this.finalizeDictOrArray( $art.elements ); }
  ;

typeArray[ art ]
@after { /* #ATN 1 */ }
  :
    (
      array=ARRAY of=OF
      { $art.items = { location: this.tokenLocation( $array, $of ) }; }
    | many=MANY
      { $art.items = { location: this.tokenLocation( $many ) };}
    )
    // #ATN: typeRefOptArgs can start with TYPE
    ( typeStruct[ $art.items ]
      nullability[ $art.items ]?
    | typeTypeOf[ $art.items ]
      nullability[ $art.items ]?
      (
        ENUM '{' { $art.items.enum = this.createDict(); }
        enumSymbolDef[ $art.items ]*
        '}' { this.finalizeDictOrArray( $art.items.enum ); }
        nullability[ $art.items ]?
      )?
    | typeRefOptArgs[ $art.items ]
      nullability[ $art.items ]?
      (
        ENUM '{' { $art.items.enum = this.createDict(); }
        enumSymbolDef[ $art.items ]*
        '}' { this.finalizeDictOrArray( $art.items.enum ); }
        nullability[ $art.items ]?
      )?
    )
  ;

typeAssociationBase[ art, handleTypeCompo ] // including Composition
  :
    (
      assoc=ASSOCIATION cardinality[$art]? TO
      {{
        let location = this.tokenLocation($assoc);
        $art.type = { path: [{ id: 'cds.Association', location }], scope: 'global', location };
        this.handleComposition( $art.cardinality, false );
      }}
    |
      compo=COMPOSITION cardinality[$art]? OF
      {{
        let location = this.tokenLocation($compo);
        $art.type = { path: [{ id: 'cds.Composition', location }], scope: 'global', location };
        this.handleComposition( $art.cardinality, handleTypeCompo );
      }}
    )
    { $art.target = {}; }
  ;

typeAssociationCont[ art ]
  :
    (
      '{' { $art.foreignKeys = this.createDict(); }
      (
        foreignKey[ $art ]
        ( ',' { if (this.isStraightBefore("}")) break; } // allow ',' before '}'
          foreignKey[ $art ]
        )*
      )?
      '}' { this.finalizeDictOrArray( $art.foreignKeys ); }
      defaultAndNullability[ $art ]?
    |
      ON cond=condition
      { $art.on=$cond.expr; }
    |
      defaultAndNullability[ $art ]
    )
  ;

typeAssociationElementCont[ art ] // including Composition
// optional NULL / NOT NULL for managed association only
  :
    (
      '{' { $art.foreignKeys = this.createDict(); }
      (
        foreignKey[ $art ]
        ( ',' { if (this.isStraightBefore("}")) break; } // allow ',' before '}'
          foreignKey[ $art ]
        )*
      )?
      '}' { this.finalizeDictOrArray( $art.foreignKeys ); }
      defaultAndNullability[ $art ]?
    |
      ON cond=condition
      { $art.on=$cond.expr; }
    |
      defaultAndNullability[ $art ]
    )?
    { this.docComment( $art ); }
    annotationAssignment_ll1[ $art ]*
    requiredSemi                     // also req after foreign key spec
  ;

typeToOne[ art ]
  :
    one=ONE
    { this.setMaxCardinality( $art, { literal: 'number', val: 1 }, $one ); }
    simplePath[ $art.target, 'artref' ]
  ;

typeToMany[ art ]
  :
    many=MANY
    { this.setMaxCardinality( $art, { literal: 'string', val: '*' }, $many ); }
    simplePath[ $art.target, 'artref' ]
  ;

cardinality[ art ] locals[ card = {} ]
@after { $art.cardinality = this.attachLocation($card); }
  :
    lbrack='[' { $card.targetMax = this.valueWithTokenLocation( '*' ); }
    (
      '*'      { $card.targetMax = this.valueWithTokenLocation( '*' ); }
      ( ',' targetCardinality[ $card ] )?
    |
      Number   { $card.targetMax = this.unsignedIntegerLiteral(); }
      (
        ',' targetCardinality[ $card ]
      |
        '..'     { $card.targetMin = $card.targetMax; }
        ( '*'    { $card.targetMax = this.valueWithTokenLocation( '*' ); }
        | Number { $card.targetMax = this.unsignedIntegerLiteral(); }
        )
      )?
    )?
    ']'
  ;

targetCardinality[ card ]
  :
    { $card.sourceMax = $card.targetMax; }
    (
      '*'      { $card.targetMax = this.valueWithTokenLocation( '*' ); }
    |
      Number   { $card.targetMax = this.unsignedIntegerLiteral(); }
      (
        '..'     { $card.targetMin = $card.targetMax; }
        ( '*'    { $card.targetMax = this.valueWithTokenLocation( '*' ); }
        | Number { $card.targetMax = this.unsignedIntegerLiteral(); }
        )
      )?
    )
  ;

// TO be used when NOT and NULL are already in the lookahead set:
optInvisibleNullability[ art ]
  : { this.setLocalTokenForId( 1, { 'NOT': 'HelperToken1', 'NULL': 'HelperToken2' } ); }
    ( n1=HelperToken1 n2=NULL { this.setNullability( $art, $n1, $n2 ); }
    | n1=HelperToken2         { this.setNullability( $art, $n1, null ); }
    )?
  ;

nullability[ art ]
@after{ this.setNullability( $art, $n1, $n2 ); }
  : n1=NOT n2=NULL
  | n1=NULL
  ;

foreignKey[ outer ] locals[ art = new parser.XsnArtifact(), elem = {} ]
@after { this.attachLocation($art); }
  :
    { this.docComment( $art ); }
    annotationAssignment_ll1[ $art ]*
    simplePath[ $elem, 'ref' ] { $art.targetElement = $elem; }
    ( AS name=ident['Key'] )?
    // ANTLR errors are better if we use ( A )? instead of ( A | ):
    { if (!$ctx.name) this.classifyImplicitName( 'KeyImplicit', $art.targetElement ); }
    { this.addDef( $art, $outer, 'foreignKeys', 'key', ($ctx.name) ? $name.id : $elem.path ); }
  ;

typeTypeOf[ art ] locals[ _sync = 'nop' ]
@after { this.attachLocation($art.type); }
  :
    t=TYPE o=OF
    { $art.type = { scope: 'typeOf' }; }
    simplePath[ $art.type, 'ref' ]
    ( ':'
      // If we have too much time, we could set the category of the simple path
      // before to 'artref'
      { $art.type.scope = $art.type.path.length; }
      simplePath[ $art.type, 'ref']
    )?
    // We do not use (…|) here instead (…)? due to different ANTLR code generation:
    // (…|) would check for follow set, which does not work with local token rewrite
    { if ($art.type.scope === 'typeOf')
      // Better error locations and much simpler code if we consider it as a path breakout:
      $art.type.path.unshift( { id: 'type of', location: this.tokenLocation( $t, $o )} );
    }
  ;

typeRefOptArgs[ art ]
@init { $art.type = {}; }
  :
    simplePath[ $art.type, 'artref' ]
    (
      typeRefArgs[ $art ]
    |
      ':'
      { $art.type.scope = $art.type.path.length; }
      simplePath[ $art.type, 'ref']
    )?
  ;

typeRefArgs[ art ]
@after { this.checkTypeArgs($art); }
  :
    paren='(' { $art['$'+'typeArgs'] = this.createArray(); }
    (
      // unnamed arguments
      head=Number
      { $art['$'+'typeArgs'].push( this.unsignedIntegerLiteral() ); }
      ( ',' { if (this.isStraightBefore(')')) break; } // allow ',' before ')'
        (
          v=VARIABLE
          { $art['$'+'typeArgs'].push(
            { literal: 'string', val: 'variable', location: this.tokenLocation($v) } );
          }
        |
          f=FLOATING
          { $art['$'+'typeArgs'].push(
            { literal: 'string', val: 'floating', location: this.tokenLocation($f) } );
          }
        |
          tail=Number
          { $art['$'+'typeArgs'].push( this.unsignedIntegerLiteral() ); }
        )
      )*
    |
      // named arguments
      typeNamedArg[ $art ]
      ( ',' { if (this.isStraightBefore(')')) break; } // allow ',' before ')'
        typeNamedArg[ $art ]
      )*
    )
    ')'{ this.finalizeDictOrArray( $art['$'+'typeArgs']); }
  ;

typeNamedArgList[ art ]
  :
    paren='('
    typeNamedArg[ $art ]
    ( ',' { if (this.isStraightBefore(')')) break; } // allow ',' before ')'
      typeNamedArg[ $art ]
    )*
    ')'
  ;

typeNamedArg[ art ] locals[ arg = '' ]
  :
    name=ident['typeparamname']
    ':'
    { if ($name.id && this.checkTypeFacet( $art, $name.id ))
        $arg = $name.id.id;
    }
    (
      Number
      { if ($arg && $art && $name.id) {
          $art[$arg] = this.unsignedIntegerLiteral();
        }
      }
    |
      v=VARIABLE
      { if ($arg && $art && $name.id) {
          $art[$arg] = { literal: 'string', val: 'variable', location: this.tokenLocation($v) };
        }
      }
    |
      f=FLOATING
      { if ($arg && $art && $name.id) {
          $art[$arg] = { literal: 'string', val: 'floating', location: this.tokenLocation($f) };
        }
      }
    )
  ;

// Queries: the main query structure --------------------------------------------

queryEOF returns [ query ]
  :
    q=queryExpression { $query = $q.query; } ';'? EOF
  ;

projectionSpec returns[ query ] locals[ src ]
@after { this.attachLocation($query); }
  :
    proj=PROJECTION ON
    // now a simplified `tableTerm`:
    {
      $src = { path: [] };
      $query = { op: this.valueWithTokenLocation( 'SELECT', $proj ), from: $src, location: this.startLocation() };
    }
    fromPath[ $src, 'artref']
    ( ':'
      { $src.scope = $src.path.length; }
      fromPath[ $src, 'ref']
    )?
    ( AS aliasName=ident['FromAlias'] { $src.name = $aliasName.id } )?
    // ANTLR errors are better if we use ( A )? instead of ( A | ):
    { if (!$src.name) this.classifyImplicitName( $src.scope ? 'FromElemImplicit' : 'FromImplicit', $src ); }
    bracedSelectItemListDef[ $query, 'columns' ]?
    excludingClause[ $query ]?
  ;

projectionClauses[ query ]
@after { this.attachLocation($query); }
  :
    ( WHERE cond=condition { $query.where = $cond.expr; } )?
    (
      GROUP BY
      e1=expression { $query.groupBy = [ $e1.expr ]; }
      ( ',' en=expression { $query.groupBy.push( $en.expr ); } )*
    )?
    ( HAVING having=condition { $query.having = $having.expr; } )?
    ( ob=orderByClause[ $query ] { $query = $ob.query; } ) ?
    ( lc=limitClause[ $query ]   { $query = $lc.query; } ) ?
  ;

queryExpression returns[ query ] // QLSubqueryComplex, SubqueryComplex
@after{ this.attachLocation($query); }
  :
    qt1=queryPrimary { $query = $qt1.query; }
    ( qec=queryExpressionCont[ $query ] { if ($qec.query) $query = $qec.query; } )?
  ;


// queryExpression continuation: Everything after a queryPrimary.
// All parts are optional on their own. We unfold them to make at least one required
// and this rule non-empty.
queryExpressionCont[ inQuery ] returns[ query = inQuery ]
@after{ this.attachLocation($query); }
@init{ if (!$inQuery) return $ctx; }
  :
    // in `conditionOrQueryParenthesis`, inQuery might nullish, as the left side
    // was an expression:
    (
      // Precendence: 1
      ( op=UNION  quant=( DISTINCT | ALL )?
      | op=EXCEPT quant=DISTINCT?
      | op=MINUS  quant=DISTINCT?
        // Precedence: 2
      | op=INTERSECT quant=DISTINCT?
      )
      qp=queryPrimary
      { $query = this.leftAssocBinaryOp( $query, $qp.query, $op, $quant, 'quantifier' );
        $ctx.quant = null; }   // reset for loop
    )+
    ( ob=orderByClause[ $query ]           { $query = $ob.query; } ) ?
    ( lc=limitClause[ $query ]             { $query = $lc.query; } ) ?
  |
    ob=orderByClause[ $query ]             { $query = $ob.query; }
    ( lc=limitClause[ $query ]             { $query = $lc.query; } ) ?
  |
    lc=limitClause[ $query ]               { $query = $lc.query; }
  ;

queryPrimary returns[ query = {} ]
@after { this.attachLocation($query); }
  :
    open='(' qe=queryExpression close=')'
    { $query = this.surroundByParens( $qe.query, $open, $close ); }
  |
    qpnp=selectQuery { $query = $qpnp.query; }
  ;

selectQuery returns[ query = {} ]
@after { this.attachLocation($query); }
  :
    select=SELECT
    { $query = { op: this.valueWithTokenLocation( 'SELECT', $select ), location: this.startLocation() }; }
    (
      FROM querySource[ $query ]
      (
        mixin=MIXIN '{' { $query.mixin = this.createDict(); }
        mixinElementDef[ $query ]*
        '}' { this.finalizeDictOrArray( $query.mixin ); }
        INTO
      )?
      ( ad=( ALL | DISTINCT )     // TODO: or directly after SELECT ?
      { $query.quantifier = this.valueWithTokenLocation( $ad.text.toLowerCase(), $ad ); }
      )?
      bracedSelectItemListDef[ $query, 'columns' ]?
      excludingClause[ $query ]?
    |
      ( ad=( ALL | DISTINCT )     // TODO: or directly after SELECT ?
      { $query.quantifier = this.valueWithTokenLocation( $ad.text.toLowerCase(), $ad ); }
      )?
      { $query.columns = []; }  // set it early to avoid "wildcard" errors
      selectItemDef[ $query.columns ]
      ( ',' { if (this.isStraightBefore("}")) break; } // allow ',' before '}'
        selectItemDef[ $query.columns ]
      )*
      FROM querySource[ $query ]
    )
    ( WHERE cond=condition { $query.where = $cond.expr; } )?
    (
      GROUP BY
      e1=expression { $query.groupBy = [ $e1.expr ]; }
      ( ',' en=expression { $query.groupBy.push( $en.expr ); } )*
    )?
    ( HAVING having=condition { $query.having = $having.expr; } )?
  ;

querySource[ query ]
@after { this.attachLocation($query.from); }
  :
    t1=tableExpression { $query.from = $t1.table; }
    (
      { const location = this.tokenLocation( this.getCurrentToken() );
        $query.from = { op: { val: 'join', location },
                        join: { val: 'cross', location },
                        args: [$t1.table] }; }
      ( ',' tn=tableExpression { this.pushItem($query.from.args, $tn.table ); } )+
    )?
  ;

tableExpression returns[ table ] // TableOrJoin
@after { this.attachLocation($table); }
  :
    qt=tableTerm { $table = $qt.table; }
    ( tec=tableExpressionCont[ $table ] { if ( $tec.table ) $table = $tec.table; } )?
  ;

// tableExpression continuation
tableExpressionCont[ inTable ] returns[ table = inTable ] // TableOrJoin
  :
    (
      join=joinOp[ $table ] { $table = $join.table; }
      te=tableExpression
      { $table ??= {}; this.pushItem($table.args, $te.table ); }
      ON cond=condition { $table.on = $cond.expr; }
    |
      crj=CROSS jn=JOIN t=tableTerm
      { if (!$table) { $table = {}; } $table = this.leftAssocBinaryOp( $table, $t.table, $jn, $crj, 'join' ); }
    )+
  ;

tableTerm returns [ table ]
@after{ this.attachLocation($table); }
  :
    ttnp=fromRefWithOptAlias    { $table = $ttnp.table; }
  |
    ttp=tableOrQueryParenthesis { $table = $ttp.table; }
  ;

fromRefWithOptAlias returns [ table ]
  :
    { $table = { path: [] }; }
    f=fromPath[ $table, 'artref']
    { if ($f.dotAfterFilter)
        this.warning( 'syntax-invalid-path-separator', $f.dotAfterFilter,
                      { '#': 'dot', code: '.', newcode: ':' } );
    }
    ( { if (!$table.scope)
          $table.scope = $table.path.length;
        else
          this.warning( 'syntax-invalid-path-separator', this.getCurrentToken(),
                      { '#': 'colon', code: ':', newcode: '.' } );
      }
      ':' fromPath[ $table, 'ref']
    )?
    ( AS n1=ident['FromAlias'] { $table.name = $n1.id; }
    | n2=identNoKeyword['FromAlias'] { $table.name = this.fragileAlias( $n2.id ); }
      // if we would use rule `ident`, we would either had to make all JOIN
      // kinds reserved or introduce ATN
    )?
    // ANTLR errors are better if we use ( A | B )? instead of ( A | B | ):
    { if (!$table.name) this.classifyImplicitName( $table.scope ? 'FromElemImplicit' : 'FromImplicit', $table ); }
  ;

// the combined ambiguity-free `'(' ( tableExpression | queryExpression ) ')'`:
tableOrQueryParenthesis returns [ table, kind ]
  :
    // To fix an ambiguity between queryPrimary and tableTerm, which could both start with `(`,
    // we use their variants without parentheses and instead use this rule recursivley if we
    // encounter '('.
    open='('
    (
      ttp=tableOrQueryParenthesis
      { $table = $ttp.table;;  $kind = $ttp.kind;; }
      ( qtec=tableOrQueryExpressionCont[ $table, $kind ]
        { $table = $qtec.table;;  $kind = $qtec.kind;; }
      )?
    |
      ttnp=fromRefWithOptAlias
      { $table = $ttnp.table;; $kind = 'table-expr'; }
      ( tec=tableExpressionCont[ $table ]
        { if ($tec.table) { $table = $tec.table; } }
      )?
    |
      qpnp=selectQuery
      { $table = $qpnp.query;; $kind = 'query-expr'; }
      ( qec=queryExpressionCont[ $table ]
        { if ($qec.query) { $table = $qec.query; } }
      )?
    )
    close=')'

    { const asQuery = $kind === 'query-expr';
      $table = this.surroundByParens( $table.query || $table, $open, $close, asQuery );
      // alias only for sub-queries; avoids `AS` in code completion
      if (!asQuery) { return $ctx; }
    }
    (
      AS a1=ident['FromAlias'] { $table.name = $a1.id } // for defining table alias
      { $kind = 'table-expr'; }
    | a2=identNoKeyword['FromAlias'] { $table.name = this.fragileAlias( $a2.id, true ); }
      // not using `ident` to have a similar behavior to above
      { $kind = 'table-expr'; }
    )?
  ;

// Continuation rule for tableOrQueryParenthesis: Continue the query/table, e.g.
// JOINs or UNIONs.  Query continuation is only possible for queries ($inKind),
// table continuation is always possible.
tableOrQueryExpressionCont[ inTable, inKind ] returns [ table = inTable, kind ]
  :
    { if ($inKind !== 'query-expr') { return $ctx; }
      $table = $table.query || $table; }
    qec=queryExpressionCont[ $table ] { $table = $qec.query;; $kind = 'query-expr';; }
  |
    tec=tableExpressionCont[ $table ] { $table = $tec.table;; $kind = 'table-expr';; }
  ;

fromPath[ qp, idkind ] returns[ dotAfterFilter = null ]
@after{ this.attachLocation($qp); }
  :
    id=ident[$idkind] { this.pushIdent( $qp.path, $id.id ); }
    ( fromArguments[ $id.id ] cardinalityAndFilter[ $id.id ]?
      { $dotAfterFilter = false; }
    | cardinalityAndFilter[ $id.id ]
      { $dotAfterFilter = false; }
    )?
    (
      { if ($dotAfterFilter === false) {
        $dotAfterFilter = this.getCurrentToken();
        if (!$qp.scope) $qp.scope = $qp.path.length;
      } }
      '.' id=ident[$idkind] { this.pushIdent( $qp.path, $id.id ); }
      ( fromArguments[ $id.id ] cardinalityAndFilter[ $id.id ]?
        { if (!$dotAfterFilter) $dotAfterFilter = false; }
      | cardinalityAndFilter[ $id.id ]
        { if (!$dotAfterFilter) $dotAfterFilter = false; }
      )?
    )*
  ;

fromArguments[ pathStep ]
@init{ if (!$pathStep) $pathStep = {}; } // grammar robustness, see test/negative/parser/NamedExpression.cds
  :
    '(' { $pathStep.args = this.createDict(); $pathStep['$'+'syntax'] = ':'; } // necessary?
    name=ident['paramname'] ':'
    namedExpression[ $pathStep, $name.id ]
    ( ',' { if (this.isStraightBefore(')')) break; } // allow ',' before ')'
      name=ident['paramname'] ':'
      namedExpression[ $pathStep, $name.id ]
    )*
    ')' { this.finalizeDictOrArray( $pathStep.args ); }
  ;

// Queries: columns and other clauses -------------------------------------------

excludingClause[ query ]
  :
    // syntax is less than ideal - EXCLUDING is only useful for `*` - with
    // this syntax, people wonder what happens with explicit select items
    EXCLUDING '{' { $query.excludingDict = this.createDict(); }
    projectionExclusion[ $query ]
    ( ',' { if (this.isStraightBefore("}")) break; } // allow ',' before '}'
      projectionExclusion[ $query ]
    )*
    '}' { this.finalizeDictOrArray( $query.excludingDict ); }
  ;

projectionExclusion[ outer ] locals[ art = {} ]
@after { this.attachLocation($art); }
  :
    name=ident['ref']
    { this.addDef( $art, $outer, 'excludingDict', '', $name.id ); }
  ;

// Actually, this is a subset if elementDefInner...
// TODO: the corresponding restrictions must also be checked in the core
// compiler, as the mixin element could come via CSN
mixinElementDef[ outer ] locals[ art = { target: {} } ]
@after { /* #ATN 1 */ this.attachLocation($art); }
  :
    name=ident['Mixin'] ':'
    typeAssociationBase[ $art, false ]
    { if ($art.type) this.addDef( $art, $outer, 'mixin', 'mixin', $name.id ); }
    // #ATN: path could start with MANY or ONE - make sure a token follows in same rule!
    ( typeToMany[ $art ] | typeToOne[ $art ] | simplePath[ $art.target, 'artref' ] )
    // TODO CC: exclude every token other than ON
    typeAssociationCont[ $art ]? // better error reporting than simply `ON condition`
    requiredSemi
  ;

selectItemDef[ outer ] locals[ art ]
@after{ if ($art) this.attachLocation( $art ); }
  :
    star='*'
    { $outer.push( this.valueWithTokenLocation( '*', $star ) ); }
  |
    { $art = new this.XsnArtifact();; this.docComment( $art ); }
    annotationAssignment_atn[ $art ]*
    // VIRTUAL is keyword, except if before the following tokens texts:
    { this.setLocalToken( 'VIRTUAL', 'VIRTUAL', /^([,.:\[@]|as)$/i ) ; } // not '{'
    ( virtual=VIRTUAL { $art.virtual = this.valueWithTokenLocation( true, $virtual ); } )?
    ( key=KEY { $art.key = this.valueWithTokenLocation( true, $key ); } )?
    selectItemDefBody[ $art, $outer ]
  ;

selectItemDefBody[ art, outer ] locals[ assoc, alias ]
@after{ /* #ATN 2 */ }
  :
    { $outer.push( $art ); }
    (
      e=expression { $art.value = $e.expr; }
      // we cannot use 'condition' instead, as long as we allow aliases without
      // AS (using rule 'ident' instead of 'identNoKeyword') -> ambiguities
      ( as=AS n1=ident['ItemAlias'] { $art.name = $n1.id; }
      | n2=ident['ItemAlias'] { $art.name = this.fragileAlias( $n2.id, true ); }
      | { $alias = this.classifyImplicitName( 'ItemImplicit', $e.expr ); }
      )
      { if ($art.value && !$art.value.path) this.excludeExpected( ["'.'", "'{'"] );
        else if ($art.name) this.excludeExpected( ["'.'"] );
      }
      (
        { this.reportExpandInline( $art, false ); }
        selectItemInlineList[ $art, 'expand' ]
        excludingClause[ $art ]?
      |
        { if ($alias) $alias.token.isIdentifier = $alias.previous; }
        { this.reportExpandInline( $art, $as || this._input.LT(-1) ); }
        dot=DOTbeforeBRACE          // ...orASTERISK
        { this.reportUnexpectedSpace( $dot, undefined, true ); }
        (
          selectItemInlineList[ $art, 'inline' ]
          excludingClause[ $art ]?
        |
          star='*'
          { $art.inline = [ this.valueWithTokenLocation( '*', $star ) ]; }
        )
      )?
    |
      selectItemInlineList[ $art, 'expand' ]
      excludingClause[ $art ]?
      AS n1=ident['ItemAlias'] { $art.name = $n1.id; }
    )
    { this.docComment( $art ); }
    annotationAssignment_fix[ $art ]*
    ( ':'
      // #ATN: typeRefOptArgs can start with TYPE, REDIRECTED, ASSOCIATION
      ( re=REDIRECTED to=TO
        { $art.target = {}; }
        simplePath[ $art.target, 'artref' ]
        (
          typeAssociationCont[ $art ]
        |
          { this.docComment( $art ); }
          annotationAssignment_ll1[ $art ]*
        )
      | typeTypeOf[ $art ]
        { this.docComment( $art ); }
        annotationAssignment_ll1[ $art ]*
      | l=LOCALIZED { $art.localized = this.valueWithTokenLocation( true, $l ); }
        typeRefOptArgs[ $art ]
        { this.docComment( $art ); }
        annotationAssignment_ll1[ $art ]*
      | typeRefOptArgs[ $art ]
        { this.docComment( $art ); }
        annotationAssignment_ll1[ $art ]*
      |
        { this.classifyImplicitName( 'ItemAssoc', $art.value ); }
        { $assoc = this.associationInSelectItem( $art ); }
        typeAssociationBase[ $assoc, false ]
        // #ATN: path could start with MANY or ONE - make sure a token follows in same rule!
        ( typeToMany[ $assoc ] | typeToOne[ $assoc ] | simplePath[ $assoc.target, 'artref' ] )
        ON cond=condition
        { $assoc.on = $cond.expr; }
      )
    )?
  ;

bracedSelectItemListDef[ query ]
  :
    '{' { $query.columns = this.createArray(); }
    (
      selectItemDef[ $query.columns ]
      ( ',' { if (this.isStraightBefore("}")) break; } // allow ',' before '}'
        selectItemDef[ $query.columns ]
      )*
    )?
    '}' { this.finalizeDictOrArray( $query.columns ); this.insertSemicolon(); }
  ;

selectItemInlineList[ art, clause ]
  :
    '{' { $art[$clause] = this.createArray(); }
    (
      selectItemInlineDef[ $art[$clause] ]
      ( ',' { if (this.isStraightBefore("}")) break; } // allow ',' before '}'
        selectItemInlineDef[ $art[$clause] ]
      )*
    )?
    '}' { this.finalizeDictOrArray( $art[$clause] ); }
  ;

selectItemInlineDef[ outer ] locals[ art ]
@after{ if ($art) this.attachLocation( $art ); }
  :
    star='*'
    { $outer.push( this.valueWithTokenLocation( '*', $star ) ); }
  |
    { $art = new this.XsnArtifact();; this.docComment( $art ); }
    annotationAssignment_atn[ $art ]*
    { if (this.getCurrentToken().text.toUpperCase() === 'VIRTUAL') this.reportVirtualAsRef(); }
    selectItemDefBody[ $art, $outer ]
  ;

orderByClause[ inQuery ] returns [ query = inQuery ]
  :
    ORDER { $query = this.unaryOpForParens( $inQuery, '$'+'query' ); } BY
    ob1=orderBySpec { if ($query) $query.orderBy = [ $ob1.ob ]; }
    ( ',' obn=orderBySpec  { if ($query) $query.orderBy.push( $obn.ob ); } )*
  ;

limitClause[ inQuery ] returns [ query = inQuery ]
  :
    limkw=LIMIT { $query = this.unaryOpForParens( $inQuery, '$'+'query', true ); }
    lim=expression  { if ($query) $query.limit = { rows: $lim.expr }; }
    ( OFFSET off=expression { if ($query) $query.limit.offset = $off.expr; } )? // unsigned integer
  ;

orderBySpec returns[ ob ]
  :
    e=expression { $ob = $e.expr; }
    ( asc=ASC   { $ob.sort = this.valueWithTokenLocation( 'asc', $asc ); }
    | desc=DESC { $ob.sort = this.valueWithTokenLocation( 'desc', $desc ); }
    )?
    ( nb=NULLS ne=( FIRST | LAST )
      { $ob.nulls = this.valueWithTokenLocation( $ne.text.toLowerCase(), $nb, $ne ); }
    )?
  ;

joinOp[ left ] returns[ table ] locals [ join ]
  :
    ( op=JOIN { $join = 'inner'; }
    | t1=INNER c=joinCardinality? op=JOIN { $join = 'inner' }
    | t1=LEFT t2=OUTER? c=joinCardinality? op=JOIN { $join = 'left' }
    | t1=RIGHT t2=OUTER? c=joinCardinality? op=JOIN { $join = 'right' }
    | t1=FULL t2=OUTER? c=joinCardinality? op=JOIN { $join = 'full' }
    )
    { $table = { op: this.valueWithTokenLocation( 'join', $op ),
                 join: this.valueWithTokenLocation( $join, $t1 || $op, $t2 ),
                 args: ($left ? [$left] : []),
                 location: $left && $left.location };
      if ($ctx.c) $table.cardinality = $c.joinCard; }
  ;

joinCardinality returns [ joinCard ]
@init { $joinCard = {}; }
@after { this.attachLocation($joinCard); }
  :
    (
      srcExact=EXACT?
      srcMaxOne=ONE
      { if($srcExact)
          $joinCard.sourceMin = { literal: 'number', val: 1,
                                  location: this.tokenLocation($srcExact) };
        $joinCard.sourceMax = { literal: 'number', val: 1,
                                  location: this.tokenLocation($srcMaxOne) }; }
    |
      srcMaxMany=MANY
      { $joinCard.sourceMax = { literal: 'string', val: '*',
                                   location: this.tokenLocation($srcMaxMany) }; }
    )
    TO
    (
      tgtExact=EXACT? tgtMaxOne=ONE
      { if($tgtExact)
          $joinCard.targetMin = { literal: 'number', val: 1,
                                  location: this.tokenLocation($tgtExact) };
        $joinCard.targetMax = { literal: 'number', val: 1,
                              location: this.tokenLocation($tgtMaxOne) }; }
    |
      tgtMaxMany=MANY
      { $joinCard.targetMax = { literal: 'string', val: '*',
                                location: this.tokenLocation($tgtMaxMany) }; }
    )
  ;

// Conditions and expressions ---------------------------------------------------

// With "separate" `condition` and `expression` rules, we have long LL
// ambiguities (not so with LALR used in Bison) with initial left parentheses:
//   ( ( ( a.b.c + d.e.f
//       )     // now we know: 3rd left-paren for expression
//       =     // now we know: 1st and 2nd left-paren for condition
//       3 ) ) )
//
// To avoid expensive parsing, we "combine" both rules, i.e. inside '('…')' of
// rule `expressionTerm`, we recursively refer to `condition`, not
// `expression`.  With that, the existence of relations/predicates in rule
// `conditionTerm` must be optional.  Correct conditions and expressions must
// be then ensured by code (either in actions of the grammar or in a check
// phase - to be discussed).
//
// We cannot generally allow `condition` where `expression` is written:
//  - IN is also used in non-standard function `args` and as predicate:
//  - AND is boolean operator and also used for BETWEEN…AND
//
// ANTLR4s left-recursion feature cannot be used as we will have rule
// arguments.

conditionEOF returns [ cond ]
  :
    c=condition { $cond = $c.expr; } EOF
  ;

condition returns[ expr ]
@after{ $expr = ($ctx.cc || $ctx.c1)?.expr; }
  :
    c1=conditionTerm cc=conditionCont[ [$c1.expr] ]?
  ;

conditionCont[ args ] returns[ expr ] locals[ right ]
@after{ $expr = this.argsExpression( $args, $args['$'+'opPrecedence'] !== 0 || '?:' ); }
  :
    (
      ( OR  { $right = this.pushOpToken( $args, 2 ); }
      | AND { $right = this.pushOpToken( $args, 4 ); }
      )
      c1=conditionTerm { $right.push($c1.expr); }
    )+
    (
      // '?' is not mentioned in code completion, see errorStrategy.js#intervalSetToArray
      '?' { this.pushOpToken( $args, 0 ); }
      // pushOpToken automatically collects the args as left side
      e2=expression { $args.push($e2.expr); }
      colon=':' { this.pushXprToken( $args ); }
      e3=expression { $args.push($e3.expr); }
    )?
  |
    q='?' { $args.nary = '?:';; this.pushOpToken( $args, 0 ); }
    e2=expression { $args.push($e2.expr); }
    colon=':' { this.pushXprToken( $args ); }
    e3=expression { $args.push($e3.expr); }
  ;

conditionTerm returns[ expr ] locals[ args = [], subs ]
@after{ $expr = ($ctx.c1 || $ctx.cc || $ctx.ec || $ctx.e1)?.expr; }
  :
    c1=conditionPrimary { $args.push($c1.expr); }
  |
    e1=conditionOrQueryParenthesis
    ec=expressionCont[[$e1.expr]]?
    cc=comparisonCont[[ ($ctx.ec || $ctx.e1)?.expr ]]?
  ;

// Note: New operators need to be added to functionExpressionOperatorsRequireParentheses[] in toCdl.js.
conditionPrimary returns[ expr ] locals[ args = [] ]
@after{ $expr ??= this.argsExpression( $args, false ); }
  :
    NOT { this.pushXprToken( $args ); }
    c1=conditionTerm { $args.push($c1.expr); }
  |
    EXISTS { this.pushXprToken( $args ); }
    (
      open='(' qe=queryExpression close=')'
      { $args.push( this.surroundByParens( $qe.query, $open, $close, true ) ); }
    |
      qm=( HideAlternatives | '?' )
      { $args.push( { param: this.valueWithTokenLocation( '?', $qm ), scope: 'param' } );
        this.csnParseOnly( 'syntax-unsupported-param', [ $qm ], { '#': 'dynamic', code: '?' } );
      }
    |
      ep=valuePath[ 'ref' ] { $args.push( $ep.qp ); }
      { $ep.qp['$'+'expected'] = 'exists'; } // hm, really in parser? what about CSN input?
    )
  |
    e1=expressionPrimary
    ec=expressionCont[[$e1.expr]]?
    cc=comparisonCont[[ ($ctx.ec || $ctx.e1)?.expr ]]?
    { $expr = ($ctx.cc || $ctx.ec || $ctx.e1)?.expr; }
  ;

// Note: New operators need to be added to functionExpressionOperatorsRequireParentheses[] in toCdl.js.
comparisonCont[ args ] returns[ expr ]
@after{ $expr = this.argsExpression( $args, false ); }
  :
    ( '=' | '<>' | '>'  | '>=' | '<' | '<=' | '!=' ) { this.pushXprToken( $args ); }
    ( ( ANY | SOME | ALL ) { this.pushXprToken( $args ); } )?
    e2=expression { this.pushItem( $args, $e2.expr ); }
  |
    IS { this.pushXprToken( $args ); }
    ( NOT { this.pushXprToken( $args ); } )?
    NULL { this.pushXprToken( $args ); }
  |
    ( NOT { this.pushXprToken( $args ); } )?
    (
      IN { this.pushXprToken( $args ); }
      // TODO: do we really allow it not to start with `(`? - TODO: try with warning
      e1=expression { $args.push( this.secureParens( $e1.expr ) ); } // including ExpressionList
    |
      BETWEEN { this.pushXprToken( $args ); }
      e2=expression { $args.push( $e2.expr ); }
      AND { this.pushXprToken( $args ); }
      e3=expression { $args.push( $e3.expr ); }
    |
      LIKE { this.pushXprToken( $args ); }
      e4=expression { $args.push( $e4.expr ); }
      ( ESCAPE { this.pushXprToken( $args ); }
        e5=expression { $args.push( $e5.expr ); }
      )?
    )
  ;

expression returns[ expr ]
  :
    ( e1=expressionPrimary           { $expr = $e1.expr; }
    | eq=conditionOrQueryParenthesis { $expr = $eq.expr; }
    )
    ( ec=expressionCont[ [$expr] ] { $expr = $ec.expr; } )?
  ;

expressionCont[ args ] returns [ expr ] locals [ right ]
@after{ $expr = this.argsExpression( $args, true ); }
  :
    (
      ( '||' { $right = this.pushOpToken( $args, 20 ); }
      | '+'  { $right = this.pushOpToken( $args, 22 ); }
      | '-'  { $right = this.pushOpToken( $args, 22 ); }
      | '*'  { $right = this.pushOpToken( $args, 24 ); }
      | '/'  { $right = this.pushOpToken( $args, 24 ); }
      )
      ( e1=expressionPrimary           { $right.push( $e1.expr ); }
      | eq=conditionOrQueryParenthesis { $right.push( $eq.expr ); }
      )
    )+
  ;

expressionPrimary returns [ expr ] locals [ args = [] ]
@after{ $expr = this.argsExpression( $args, false ); }
  :
    ( '+' | '-' )  { this.pushXprToken( $args ); }
    ( e1=expressionPrimary           { this.signedExpression( $args, $e1.expr ); }
    | eq=conditionOrQueryParenthesis { this.signedExpression( $args, $eq.expr ); }
    )
  |
    val=literalValue { $args.push( $val.val ); }
  |
    sf=specialFunction { $args.push( $sf.ret ); }
  |
    CASE { this.pushXprToken( $args ); }
    (
      e2=expression { $args.push( $e2.expr ); }
      ( WHEN { this.pushXprToken( $args ); }
        ew=expression { $args.push( $ew.expr ); }
        THEN { this.pushXprToken( $args ); }
        e3=expression { $args.push( $e3.expr ); }
      )+
    |
      (
        WHEN { this.pushXprToken( $args ); }
        c=condition { $args.push( $c.expr ); }
        THEN { this.pushXprToken( $args ); }
        e3=expression { $args.push( $e3.expr ); }
      )+
    )
    (
      ELSE { this.pushXprToken( $args ); }
      e4=expression { $args.push( $e4.expr ); }
    )?
    END { this.pushXprToken( $args ); }
  |
    ne=NEW  { this.pushXprToken( $args ); } // token rewrite for NEW
    nqp=valuePath[ 'ref', null ]
    { $args.push( this.valuePathAst( $nqp.qp ) ); }
    { this.fixNewKeywordPlacement( $args ); }
  |
    vp=valuePath[ 'ref', null ] { $args.push( this.valuePathAst( $vp.qp ) ); }
    { this.setLocalTokenIfBefore( 'OVER', 'OVER', /^\($/i ); }
    (
      { $args[0].suffix = []; }
      OVER { this.pushXprToken( $args[0].suffix ); }
      open='(' over=overClause close=')'
      { $args[0].suffix.push( this.surroundByParens( $over.over, $open, $close ) ); }
    )?
  |
    colon=':' { this.reportUnexpectedSpace( $colon ); }
    { this.meltKeywordToIdentifier(); }
    (
      vp=valuePath[ 'paramref', this.startLocation() ]
      {{ const par = $vp.qp;; par.scope = 'param';; $args.push( par ); }}
    |
      pp=Number
      // TODO: no extra XSN property `param` for this, re-use `val`
      { $args.push( { param: this.unsignedIntegerLiteral(), scope: 'param' } );
        this.csnParseOnly( 'syntax-unsupported-param', [ $pp ], { '#': 'positional', code: ':' + $pp.text } );
      }
    )
  |
    qm= '?'                   // is automatically not mentioned as CC candidate
    // if we have an HideAlternatives here, we would block it to use it in
    // parallel to an expression (would produce adaptivePredict() otherwise)
    // TODO: no extra XSN property `param` for this, re-use `val`
    { $args.push( { param: this.valueWithTokenLocation( '?', $qm ), scope: 'param' } );
      this.csnParseOnly( 'syntax-unsupported-param', [ $qm ], { '#': 'dynamic', code: '?' } );
    }
  ;

// the combined ambiguity-free `'(' ( condition (',' condition )* | queryExpression ) ')'`:
conditionOrQueryParenthesis returns[ expr ] locals[ args = [] ]
  :
    open='('
    (
      q1=selectQuery qr=queryExpressionCont[ $q1.query ]?
      { $args.push( $ctx.qr ? $qr.query : $q1.query ); }
    |
      c1=conditionPrimary cc=conditionCont[ [$c1.expr] ]?
      { this.pushItem( $args, $ctx.cc?.expr || $c1.expr ); }
      ( ',' { if ($args.length > 1 && this.isStraightBefore(')')) break; } // allow ',' before ')'
        cn=condition { this.pushItem($args, $cn.expr); }
      )*
    |
      rec=conditionOrQueryParenthesis { $args.push( $rec.expr ); }
      (
        // if !$rec.expr.query, queryExpressionCont returns immediately
        qc=queryExpressionCont[$rec.expr.query]
        { if ($qc.query) $args[0] = { query: $qc.query, location: $qc.query.location }; }
      |
        // also just the plain inner (…):
        ec=expressionCont[[$rec.expr]]?
        cm=comparisonCont[[($ctx.ec || $ctx.rec).expr]]?
        cc=conditionCont[[($ctx.cm || $ctx.ec || $ctx.rec).expr]]?
        { $args[0] = ($ctx.cc || $ctx.cm || $ctx.ec || $ctx.rec)?.expr || $args[0]; }
        ( ',' { if ($args.length > 1 && this.isStraightBefore(')')) break; } // allow ',' before ')'
          cn=condition { this.pushItem($args, $cn.expr); }
        )*
      )
    )
    close=')'
    {
      if ($args.length > 1)
        $expr = { op: this.valueWithTokenLocation( 'list', $open ), args: $args,
                  location: this.tokenLocation( $open, $close ) };
      else if ($args[0]) // can be `null` if condition failed to parse
        $expr = this.surroundByParens( $args[0], $open, $close, !!$ctx.q1 );
    }
  ;

specialFunction returns [ ret = {} ] locals[ art = new parser.XsnArtifact() ]
  :
    ca=CAST '('                 // see createArray() in action
    {
      $ret = {
        op: this.valueWithTokenLocation( 'cast', $ca ),
        args: this.createArray(),
        location: this.tokenLocation( $ca )
      };
    }
    e=expression AS typeRefOptArgs[ $ret ]
    {
      $ret.args.push( $e.expr );
    }
    ')' { this.finalizeDictOrArray( $ret.args ); }
  ;

// Paths and functions: ---------------------------------------------------------

simplePath[ art, category ] locals[ _sync = 'nop' ]
@after { this.attachLocation($art); }
// Due to error recovery, rule `ident` can return with value `null`.  Set the
// path as broken in this case.
  :
    head=ident[ $category ]
    { $art.path ??= []; this.pushIdent( $art.path, $head.id ); }
    (
      '.' tail=ident[ $category ] { this.pushIdent( $art.path, $tail.id ); }
    )*
  ;

valuePath[ category, location = null ] returns[ qp = { path: [] } ] locals[ _sync = 'nop' ]
@init { $qp.location = location || this.startLocation(); }
@after{ this.attachLocation($qp); }
  :
    id=ident[ $category ]
    { this.pushIdent( $qp.path, $id.id ); }
    ( pathArguments[ $id.id, $id.id ] cardinalityAndFilter[ $id.id ]?
    | cardinalityAndFilter[ $id.id ]
    )?
    (
      '.' id=ident['ref']       // yes 'ref', not $category
      { this.pushIdent( $qp.path, $id.id ); }
      ( pathArguments[ $id.id ] cardinalityAndFilter[ $id.id ]?
      | cardinalityAndFilter[ $id.id ]
      )?
    )*
  ;

pathArguments[ pathStep, considerSpecial ]
@init{
  if (!$pathStep) $pathStep = {}; // grammar robustness, see test/negative/parser/NamedExpression.cds
  this.genericFunctionsStack.push( this['$'+'genericKeywords'] );
}
  :
    { this.excludeExpected([ 'ORDER' ]); }
    '('                         // dict or array, see below
    // Make sure that we do not introduce A:B paths in expressions!
    // Need to avoid adaptPredict(), otherwise Generic keywords won't work in funcExpression
    //
    // For code completion, we need to handle generic tokens directly after the
    // '('.  To avoid invalidating an assoc `trim` to an entity with parameter
    // `leading` (ok, a bit constructed), we do not do it with named parameters.
    { if (!this.setLocalTokenForId( 2, { ':': 'HelperToken1', '=>': 'HelperToken2' } ))
        this.prepareGenericKeywords( $considerSpecial ); }
    (
      { $pathStep.args = this.createDict(); $pathStep['$'+'syntax'] = ':'; }
      id=HelperToken1 ':'
      namedExpression[ $pathStep, this.identAst( $id, 'paramname', true ) ]
      ( ',' { if (this.isStraightBefore(')')) break; } // allow ',' before ')'
        name=ident['paramname'] ':'
        namedExpression[ $pathStep, $name.id ]
      )*
    |
      { $pathStep.args = this.createDict(); }  // TODO: XSN func path cleanup
      id=HelperToken2 '=>'
      namedExpression[ $pathStep, this.identAst( $id, 'paramname', true ) ]
      ( ',' { if (this.isStraightBefore(')')) break; } // allow ',' before ')'
        name=ident['paramname'] '=>'
        namedExpression[ $pathStep, $name.id ]
      )*
    |
      { $pathStep.args = this.createArray(); }
      funcExpression[ $pathStep, $considerSpecial ]
      ( ',' { if (this.isStraightBefore(')')) break; } // allow ',' before ')'
        funcExpression[ $pathStep, $considerSpecial ]
      )*
      // Note: We can't move this into funcExpression, or we would increase the ATN count because of `,` amiguity.
      ( ob=funcOrderByClause[ [ $pathStep.args[$pathStep.args.length - 1] ] ]
        // Remove the last entry which was copied to $ob.expr and push $ob.expr:
        { $pathStep.args[$pathStep.args.length - 1] = $ob.expr; }
      )?
    |
      { $pathStep.args = this.createArray(); }
    )
    ')' { this.finalizeDictOrArray( $pathStep.args ); }
  ;
  finally {                     // see @init
    if (!$pathStep.args) $pathStep.args = [];
    this['$'+'genericKeywords'] = this.genericFunctionsStack.pop();
  }

namedExpression[ pathStep, id ]
  :
    elem=expression
    { if ($pathStep && $id) {
      this.addDef( ($ctx.elem && $elem.expr) ? $elem.expr : { location: $id.location },
                   $pathStep, 'args', 0, $id );
      }
    }
  ;

funcExpression[ pathStep, considerSpecial ] locals[ args = [] ]
@init { this.prepareGenericKeywords( $considerSpecial ); }
@after{ $pathStep.args.push( this.argsExpression( $args, false ) ); }
  :
    (
      expr=expression
      { $args.push( $expr.expr ); }
    |
      GenericExpr       // keyword as replacement for expression, like '*'
      { this.pushXprToken( $args ); }
    |
      GenericIntro      // keyword as introduction of expression, like DISTINCT
      { this.pushXprToken( $args ); }
      expr=expression { $args.push( $expr.expr ); }
    |
      // Rule 'pathArguments' makes a decision based on the first two lookahead
      // tokens of this rule → we need to list tokens which would be changed to
      // GenericExpr or GenericIntro, and are not already covered by 'expression'
      { this.reportErrorForGenericKeyword(); }
      ( HideAlternatives | '*' | ALL | DISTINCT ) { this.pushXprToken( $args ); }
      // now continue parsing like GenericExpr:
    )
    (
      (
        { this.prepareGenericKeywords( $considerSpecial, 'separator' ); }
        (
           GenericSeparator
        |
          // For ANTLR's lookahead calculations, we need to list tokens here
          // which could be changed to GenericSeparator.  Do not invent a
          // keyword token which is just used here (Identifier does work
          // perfectly)!  If we want, we could add all non-reserved keywords
          // except ORDER, and most reserved.
          { this.reportErrorForGenericKeyword(); }
          ( HideAlternatives | Identifier | FROM | IN | WITH | GROUP )
        )
        { this.pushXprToken( $args );
          this.prepareGenericKeywords( $considerSpecial, 'expr' ); }
        (
          expr=expression { $args.push( $expr.expr ); }
        |
          GenericExpr { this.pushXprToken( $args ); }
        |
          { this.reportErrorForGenericKeyword(); }
          // Again, we need to list tokens which could make it to GenericExpr
          // and which do not start an expression
          ( HideAlternatives | ALL ) { this.pushXprToken( $args ); }
        )
      )+
    )?
  ;

overClause returns[ over ] locals[ args = [] ]
@after{ $over = this.argsExpression( $args, false ); }
  :
    ( PARTITION { this.pushXprToken( $args ); } BY { this.pushXprToken( $args ); }
      pb=partitionByClause { $args.push( $pb.expr ); }
    )?
    ( ORDER { this.pushXprToken( $args ); } BY { this.pushXprToken( $args ); }
      ob=exprOrderByClause { $args.push( $ob.expr ); }
    )?
    ( ROWS { this.pushXprToken( $args ); }
      wf=windowFrameClause { $args.push( $wf.wf ); }
    )?
  ;

partitionByClause returns [ expr ] locals[ args = [] ]
@after{ $expr = this.argsExpression( $args, false ); }
  :
    e1=expression { $args.push( $e1.expr ); }
    ( ',' { this.pushXprToken( $args ); }
      en=expression { $args.push( $en.expr ); }
    )*
  ;

// ORDER BY clause in generic functions, e.g. `first_value(id order by name)`
funcOrderByClause[ args ] returns[ expr ]
@after{ $expr = this.argsExpression( $args, false ); }
  :
    ORDER { this.pushXprToken( $args ); } BY { this.pushXprToken( $args ); }
    ob=exprOrderByClause { $args.push( $ob.expr ); }
  ;

// ORDER BY clause in generic functions or OVER clause
exprOrderByClause returns[ expr ] locals[ args = [] ]
@after{ $expr = this.argsExpression( $args, false ); }
  :
    orderBySpecInExpr[ $args ]
    ( ',' { this.pushXprToken( $args ); } orderBySpecInExpr[ $args ] )*
  ;

orderBySpecInExpr[ args ]
  :
    e=expression { $args.push( $e.expr ); }
    ( ASC { this.pushXprToken( $args ); }
    | DESC { this.pushXprToken( $args ); }
    )?
    ( NULLS { this.pushXprToken( $args ); }
      ( FIRST | LAST ) { this.pushXprToken( $args ); }
    )?
  ;

windowFrameClause returns[ wf ] locals[ args = [] ]
@after{ $wf = this.argsExpression( $args, false ); }
  :
    (
      windowFrameStartSpec[ $args ]
    |
      BETWEEN { this.pushXprToken( $args ); }
      windowFrameBoundSpec[ $args ]
      AND { this.pushXprToken( $args ); }
      windowFrameBoundSpec[ $args ]
    )
  ;

windowFrameBoundSpec[ args ]
  :
    UNBOUNDED { this.pushXprToken( $args ); }
    ( FOLLOWING | PRECEDING ) { this.pushXprToken( $args ); }
  |
    Number { $args.push( this.unsignedIntegerLiteral() ); }
    ( FOLLOWING | PRECEDING ) { this.pushXprToken( $args ); }
  |
    CURRENT { this.pushXprToken( $args ); } ROW { this.pushXprToken( $args ); }
  ;

windowFrameStartSpec[ args = [] ]
  :
    UNBOUNDED { this.pushXprToken( $args ); }
    PRECEDING { this.pushXprToken( $args ); }
  |
    Number { $args.push( this.unsignedIntegerLiteral() ); }
    PRECEDING { this.pushXprToken( $args ); }
  |
    CURRENT { this.pushXprToken( $args ); } ROW { this.pushXprToken( $args ); }
  ;

cardinalityAndFilter[ pathStep ] locals [ _sync = 'nop' ]
  :
    { if (!$pathStep) $pathStep = {}; }
    openFilter='['
    optionalCardinality[ pathStep ]?

    filterWhereClause[ $pathStep ] // required, see rule's comment
    (
      group=GROUP by=BY
      e1=expression { $pathStep.groupBy = [ $e1.expr ]; }
      ( ',' en=expression { $pathStep.groupBy.push( $en.expr ); } )*
      { this.csnParseOnly('syntax-unexpected-sql-clause', [ $group, $by ], { keyword: 'GROUP BY' }); }
    )?
    ( hv=HAVING
      having=condition { $pathStep.having = $having.expr; }
      { this.csnParseOnly('syntax-unexpected-sql-clause', [ $hv ], { keyword: 'HAVING' }); }
    )?
    ( { const orderKw = this._input.LT(1); const byKw = this._input.LT(2); }
      ob=orderByClause[ $pathStep ] { $pathStep = $ob.query;; }
      { this.csnParseOnly('syntax-unexpected-sql-clause', [ orderKw, byKw ], { keyword: 'ORDER BY' }); }
    )?
    ( { const limit = this._input.LT(1); }
      lc=limitClause[ $pathStep ]   { $pathStep = $lc.query;; }
      { this.csnParseOnly('syntax-unexpected-sql-clause', [ limit ], { keyword: 'LIMIT' }); }
    )?

    closeFilter=']'
  ;


optionalCardinality[ pathStep ]
@after { if ($pathStep && $pathStep.cardinality) this.attachLocation($pathStep.cardinality); }
  :
    // Make sure to test second token to allow expressions starting with Number
    // without introducing WHERE - that would be @options{k=2}.  The code
    // completion just produces `:` after having inserted a Number - TODO.
    { if (this._input.LT(2).text !== ':') return $ctx; }
    ( Number
      { if ($pathStep) $pathStep.cardinality = { targetMax: this.unsignedIntegerLiteral(), location: this.startLocation() }; }
    ':'
    )
  ;

filterWhereClause[ pathStep ]
  :
    // NOTE: Keep in sync with optionalWhereForFilter!
    //
    // For ANTLR, WHERE is required, but the generated parser may skip `match(WHERE)` in
    // `optionalWhereForFilter`. Because `(WHERE cond)?` would invoke adaptive predict,
    // we use this hack that skips parsing of the condition, if the token is a SQL clause,
    // but makes Antlr assume that it is required.
    {
      const tok = this.getCurrentToken();
      if (tok.type === languageParser.GROUP
         || tok.type === languageParser.ORDER
         || tok.type === languageParser.LIMIT
         || tok.type === languageParser.HAVING)
        return $ctx;
    }
    optionalWhereForFilter cond=condition { if ($pathStep) $pathStep.where = $cond.expr; }
  ;

optionalWhereForFilter
  :
    // NOTE: only call from rule filterWhereClause!
    //
    // For ANTLR, WHERE is required, but we allow the generated parser skipping
    // the call of match(WHERE).  This hack requires that sync() at each state in
    // the calling rule does not throw an error if the current token does not match
    // one of the expected ones.
    {
      if (this.getCurrentToken().type !== languageParser.WHERE)
        return $ctx; // TODO: should we somehow add those keywords to $(EXPECTED)?
    }
    WHERE
  ;

// Annotation assignments -------------------------------------------------------

// We have three versions of the annotation assignment rules:
//  - "fix": typically after a name if a ':' could follow
//  - "ll1": typically before keyword+name, after a name if no ':' could follow
//  - "atn": at the beginning of a column definition
//
// want to let the ambiguity in select items (solution: "either" possibility)
//
//   entity E @Anno: Base { … };     // Base is include (chosen w/ warning) or @Anno value?
//   entity V(p) as select from E {  // either: anno value "ref p", select item -x
//     @anno :p - x as x;            // or: anno value true, select item :p-x
//   }

annotationAssignment_fix[ art ] locals[ assignment ]
// value outside @(...)
@after {
  if ($assignment) {
    this.assignAnnotation( $art, $assignment );
    this.docComment( $art );
  }
} :
    at='@' { this.reportUnexpectedSpace( $at ); }
    (
      annotationAssignment_paren[ $art ]
    |
      { $assignment = { name: new this.XsnName() }; }
      annotationPath[ $assignment.name, 'anno' ]
      ( '#' annotationPathVariant[ $assignment.name ] )?
      { this.warnIfColonFollows( $assignment ); }
    )
  ;

annotationAssignment_ll1[ art ] locals[ assignment ]
@after {
  if ($assignment) {
    this.assignAnnotation( $art, $assignment );
    this.docComment( $art );
  }
} :
    at='@' { this.reportUnexpectedSpace( $at ); }
    (
      annotationAssignment_paren[ $art ]
    |
      { $assignment = { name: new this.XsnName() }; }
      annotationPath[ $assignment.name, 'anno' ]
      ( '#' annotationPathVariant[ $assignment.name ] )?
      (
        ':' { this.meltKeywordToIdentifier(true); } // allow path as anno value start with reserved
        val=annoValue[ $assignment ]
      )?
    )
  ;

// Has previously used ATN, now via local token rewrite
annotationAssignment_atn[ art ] locals[ assignment ]
@after {
  if ($assignment) {
    this.assignAnnotation( $art, $assignment );
    this.docComment( $art );
  }
} :
    at='@' { this.reportUnexpectedSpace( $at ); }
    (
      annotationAssignment_paren[ $art ]
    |
      { $assignment = { name: new this.XsnName() }; }
      annotationPath[ $assignment.name, 'anno' ]
      // '#' is in the follow set of this rule, as it is used in rule "selectItemDef"
      // before an "expression" which can start with a '#' for an enum value
      // -> used to introduce variant name if and only if in same line as previous token
      { this.setLocalToken( '#', 'HelperToken1', null, true ); }
      ( hash=HelperToken1 annotationPathVariant[ $assignment.name ] )?
      // ':' is in the follow set of this rule, as it is used in rule "selectItemDef"
      // before an "expression" which can start with a ':' for a parameter reference
      // -> used to introduce assignment value if and only if in same line as previous token
      { this.setLocalToken( ':', 'HelperToken2', null, true ); }
      ( HelperToken2                        // ':'
        { this.meltKeywordToIdentifier(true); } // allow path as anno value start with reserved
        (
          val=annoValueBase[ $assignment ]
        |
          ( atv='@' annotationPath[ $assignment, 'uncheckedAnno', $atv ]
          | annotationPath[ $assignment, 'uncheckedRef', $atv ]
          )
          { this.setLocalToken( '#', 'HelperToken1', null, true ); } // see above
          ( hash=HelperToken1 annotationPathVariant[ $assignment ] )?
        )
      )?
    )
  ;

annotationAssignment_paren[ art ]
  :
    '('
    // allow completely useless `@()`; no warning anymore - who cares?
    {
      if (this.isStraightBefore(')')) {
        this.matchWildcard();   // we know it is the ')' - we do not reach the final match
        return $ctx;
      }
      this.meltKeywordToIdentifier();
    }
    annotationAssignment_1[ $art ]
    ( ','
      {
        this.meltKeywordToIdentifier();
        if (this.isStraightBefore(')')) break; // allow ',' before ')'
      }
      annotationAssignment_1[ $art ]
    )*
    ')'
  ;

annotationAssignment_1[ art ] locals[ assignment = { name: new parser.XsnName() } ]
@after { this.assignAnnotation( $art, $assignment ); }
  :
    annotationPath[ $assignment.name, 'anno' ]
    ( '#' annotationPathVariant[ $assignment.name ] )?
    (
      ':' { this.meltKeywordToIdentifier(true); } // allow path as anno value start with reserved
      val=annoValue[ $assignment ]
    )?
  ;

annotationPath[ art, category, headat = null ] locals[ _sync = 'nop' ]
@after { this.attachLocation($art); }
// Due to error recovery, rule `ident` can return with value `null`.  Set the
// path as broken in this case.
  :
    head=ident[ $category ]
    { $art.path = []; this.pushIdent( $art.path, $head.id, $headat ); }
    (
      '.' at='@'? tail=ident[ $category ]
      {
      if ($at) { $category = 'uncheckedAnno'; }
      this.pushIdent( $art.path, $tail.id, $at );
        // Otherwise, $at may continue to be set after one `.@anno` segment.
        $ctx.at = null;
      }
    )*
  ;

// Before calling this rule, match '#'
annotationPathVariant[ art ] locals[ variant = {} ]
@after { this.attachLocation($art); }
  :
    { this.reportUnexpectedSpace();; this.meltKeywordToIdentifier(); }
    simplePath[ $variant, 'variant' ] { $art.variant = $variant; }
  ;

annoValue[ assignment ]
  :
    base=annoValueBase[ $assignment ]
  |
    // no docComment() here
    // this alternative is done with token rewrite in rule "annotationAssignment_atn"
    at='@'? annotationPath[ $assignment, 'annoref', $at ]
    ( '#' annotationPathVariant[ $assignment ] )?
  ;

annoValueBase[ assignment ] locals [ seenEllipsis = false ]
@after { this.attachLocation( $assignment ); }
  :
    '{'                         // no location here, we flatten
    // TODO: for better error recovery, report error with direct `}` and return
    // might be done automatically with sub rule for things between {…}
    { $assignment['$'+'flatten'] = []; this.meltKeywordToIdentifier(); }
    flattenedValue[ $assignment ]
    (
      ',' {
        this.meltKeywordToIdentifier();
        if (this.isStraightBefore("}")) break; // allow ',' before ')'
      }
      flattenedValue[ $assignment ]
    )*
    '}'
  |
    '['                 // no need for createArray() here, $assignment.location is set
    { $assignment.val = []; $assignment.literal = 'array'; }
    { this.meltKeywordToIdentifier(true); }
    (
      (
        head=annoSubValue  { $assignment.val.push( $head.val ); }
      |
        e='...' ( UP TO upTo=annoSubValue )?
        {{
          const item = { literal: 'token', val: '...', location: this.tokenLocation($e) };
          $assignment.val.push( item );
          if ($ctx.upTo) item.upTo = $upTo.val;
          $seenEllipsis = !$ctx.upTo || 'upTo';
        }}
      )
      (
        ',' { if (this.isStraightBefore(']')) break; } // allow ',' before ']'
        { this.meltKeywordToIdentifier(true); }
        (
          tail=annoSubValue { $assignment.val.push( $tail.val ); }
        |
          { $ctx.upTo = null; } // is not reset
          e='...' ( UP TO upTo=annoSubValue )?
          {{
            const item = { literal: 'token', val: '...', location: this.tokenLocation($e) };
            if ($ctx.upTo) item.upTo = $upTo.val;
            $assignment.val.push( item );
            if ($seenEllipsis === true)
              this.error( 'syntax-unexpected-ellipsis', $e,
                          { '#': 'duplicate', code: '...', keyword: 'up to' } );
            else
              $seenEllipsis = !$ctx.upTo || 'upTo';
          }}
        )
      )*
    )?
    cb=']'
    {
      if ($seenEllipsis === 'upTo')
        this.error( 'syntax-missing-ellipsis', $cb, // at closing bracket
                    { code: '... up to', newcode: '...' } );
    }
  |
    v1=literalValue { this.assignAnnotationValue( $assignment, $v1.val ); }
  |
    ( plus='+' | min='-' ) num=Number
    {  this.assignAnnotationValue( $assignment, this.numberLiteral( $plus||$min ) ); }
  |
    '('
      cond=condition // 'condition' is also used in 'expression' inside '()'.
      // TODO: (1,2,3) not supported, yet, only ((1,2,3)); we could support it via:
      // (',' condition)*
      { this.expressionAsAnnotationValue( $assignment, $cond.expr, $cond.start, $cond.stop ); }
    ')'
  ;

flattenedValue[ assignment ] locals[ val = { name: new parser.XsnName() } ]
  :
    at='@'? annotationPath[ $val.name, 'name', $at ]
    ( '#' annotationPathVariant[ $val.name ] )?
    (
      ':' { this.meltKeywordToIdentifier(true); } // allow path as anno value start with reserved
      annoValue[ $val ]
    )?
    { $assignment['$'+'flatten'].push( $val ); }
  ;

namedValue[ struct ] locals[ val = { name: new parser.XsnName() } ]
  :
    at='@'? annotationPath[ $val.name, 'name', $at ]
    ( ':' { this.meltKeywordToIdentifier(true); }
      sub=annoSubValue { this.assignAnnotationValue( $val, $sub.val ); } )?
    {
      if (!$val.location) $val.location = $val.name.location;
      this.addDef( $val, $struct, 'struct', null, $val.name ); // TODO: re-check name
    }
  ;

annoSubValue returns[ val = {} ]
@after { this.attachLocation($val); }
  :
    '{'                         // no need for createDict() here, $val.location is set
    { $val.struct = Object.create(null); $val.literal = 'struct'; }
    { this.meltKeywordToIdentifier(); }
    namedValue[ $val ]
    ( ','
      {
        this.meltKeywordToIdentifier();
        if (this.isStraightBefore("}")) break; // allow ',' before '}'
      }
      namedValue[ $val ]
    )*
    '}'
  |
    '['                 // no need for createArray() here, $val.location is set
    { $val.val = []; $val.literal = 'array'; }
    { this.meltKeywordToIdentifier(true); }
    ( head=annoSubValue { $val.val.push( $head.val ); }
      ( ',' { if (this.isStraightBefore(']')) break; } // allow ',' before ']'
        { this.meltKeywordToIdentifier(true); }
        tail=annoSubValue { $val.val.push( $tail.val ); }
      )*
    )?
    ']'
  |
    v1=literalValue { this.assignAnnotationValue( $val, $v1.val ); }
  |
    ( plus='+' | min='-' ) num=Number
    { this.assignAnnotationValue( $val, this.numberLiteral( $plus||$min ) ); }
  |
    at='@'? annotationPath[ $val, 'annoref', $at ]
    ( '#' annotationPathVariant[ $val ] )?
  |
    '('
      cond=condition
      { this.expressionAsAnnotationValue( $val, $cond.expr, $cond.start, $cond.stop ); }
    ')'
  ;

// Literal values and identifiers -----------------------------------------------

literalValue returns[ val ] locals[ tok ]
@init{ $tok = this.getCurrentToken(); }
@after { this.attachLocation($val); }
  :
    hash='#' { this.reportUnexpectedSpace( $hash );; this.meltKeywordToIdentifier(); }
    name=ident['enumref']   // TODO: remove from this rule (not in enum! `String enum { foo = #bar }`)
    { $val = { literal: 'enum', sym: $name.id } }
  |
    NULL
    { $val = { literal: 'null', val: null }; }
  |
    Boolean
    { $val = { literal: 'boolean', val: $tok.text.toLowerCase() != 'false' }; }
  |
    Number
    { $val = this.numberLiteral( '' ); } // allow float and large number
  |
    String
    { $val = this.quotedLiteral( $tok, 'string' ); }
  |
    QuotedLiteral               // x'12', date'...', time'...', timestamp'...'
    { $val = this.quotedLiteral( $tok ); }
  ;

// #IDENT - keep this comment here, used in scripts/linter/lintGrammar.js

identNoKeyword[ category ] returns[ id ]    // for aliases without AS
@after{ $id = this.identAst( null, $category ); }
  :
    Identifier
  ;

// The `ident` rule matches `Identifier` and all non-reserved keywords.  List
// all non-reserved keywords directly, do not use an indirection via a rule
// like `nonReservedKeywords`.
ident[ category ] returns[ id ]
@after{ $id = this.identAst( null, $category ); }
  :
    Identifier
  | ABSTRACT
  | ACTION
  | ACTIONS
  | AND
  | ANNOTATE
  | ANNOTATION
  | ARRAY
  | ASC
  | ASPECT
  | ASSOCIATION
  | BETWEEN
  | COLUMNS
  | COMPOSITION
  | CONTEXT
  | CROSS
  | CURRENT
  | DEFAULT
  | DEFINE
  | DEFINITIONS
  | DESC
  | ELEMENTS
  | ELSE
  | END
  | ENTITY
  | ENUM
  | ESCAPE
  | EVENT
  | EXACT
  | EXCEPT
  | EXCLUDING
  | EXTEND
  | FIRST
  | FLOATING
  | FOLLOWING
  | FULL
  | FUNCTION
  | GROUP
  | HAVING
  | INNER
  | INTERSECT
  | INTO
  | IS
  | JOIN
  | LAST
  | LEFT
  | LIKE
  | LIMIT
  | LOCALIZED
  | MANY
  | MINUS
  | MIXIN
  | NAMESPACE
  | NULLS
  | OFFSET
  | ONE
  | OR
  | ORDER
  | OUTER
  | PARAMETERS
  | PARTITION
  | PRECEDING
  | PROJECTION
  | REDIRECTED
  | RETURNS
  | RIGHT
  | ROW
  | ROWS
  | STORED
  | SERVICE
  | THEN
  | UNION
  | UP
  | TO
  | TYPE
  | USING
  | UNBOUNDED
  | VARIABLE
  | VIEW
  ;

// LEXER ------------------------------------------------------------------------

WhiteSpace                      // like \s in JavaScript RegExp
  :                             // LineTerminator | [\t\f\v\u00A0\uFEFF] | Zs
    [\r\n\u2028\u2029 \t\f\u000B\u00A0\u1680\u180e\u2000-\u200A\u202F\u205F\u3000\uFEFF]+
    -> skip ;

DocComment : '/**' ('*/' | ~[/] .*? '*/') -> channel(HIDDEN);

Comment : '/*' ( '*/' | ~[*] .*? '*/' ) -> channel(HIDDEN);

LineComment : '//' ~[\r\n\u2028\u2029]* -> channel(HIDDEN);

// Literal values ---------------------------------------------------------------

// for syntactic code-completion: Combine all three string styles
// Note: Use rule `string` instead as that also parses escape sequences! (TODO: ???)
String : SingleLineString
       | MultiLineString
       | MutlLineStringBlock;

fragment SingleLineString
  :
      // \u0027 = '\''
      // \u2028 = LS (Line Separator)
      // \u2029 = PS (Paragraph Separator)
      ( '\'' ~[\u0027\n\r\u2028\u2029]* '\'' )+ //
  ;

fragment MultiLineString
  :
    ('`' ( MultiLineStringContentChar | EscapeSequence )* '`' )
  ;

fragment MutlLineStringBlock
  :
    ('```' ( MultiLineStringContentChar | EscapeSequence )*  '```')
  ;

fragment EscapeSequence
  :
   // we could list each escape sequence explicitly, but we already
   // decode them in genericAntlrParser.js, so no need to do work twice.
   '\\' .
  ;

fragment MultiLineStringContentChar
  :
   (~[\u0060\\]) // \u0060 = '`'
  ;

QuotedLiteral
  :
    ( [xX] | [dD][aA][tT][eE] | [tT][iI][mM][eE] ( [sS][tT][aA][mM][pP] )? )
    ( '\'' ~[\u0027\n\r\u2028\u2029]* '\'' )+ // \u0027 = '\''
  ;

// This literal improves error messages for unterminated literals.
UnterminatedLiteral
  :
    ( [xX] | [dD][aA][tT][eE] | [tT][iI][mM][eE] ( [sS][tT][aA][mM][pP] )? )?
    '\'' ~[\u0027\n\r\u2028\u2029]* // \u0027 = '\''
    |
    ('`' ( MultiLineStringContentChar | EscapeSequence )* )
    |
    ('```' ( MultiLineStringContentChar | EscapeSequence )* )
  ;

UnterminatedDelimitedIdentifier
  :
    '"' ~[\u0022\n\r\u2028\u2029]* ( '""' ~[\u0022\n\r\u2028\u2029]* )* // \u0022 = '"'
  | '![' ~[\u005d\n\r\u2028\u2029]*  ( ']]' ~[\u005d\n\r\u2028\u2029]* )* // \u005d = ']'
// \u005d = ']'
  ;

Boolean                         // TMP?
  : [tT][rR][uU][eE] | [fF][aA][lL][sS][eE]
  ;

// Reserved keywords (are case-insensitive): ---------------------------------

ALL : [aA][lL][lL] ;
ANY : [aA][nN][yY] ;
AS : [aA][sS] ;
BY : [bB][yY] ;
CASE : [cC][aA][sS][eE] ;
CAST : [cC][aA][sS][tT] ;
DISTINCT : [dD][iI][sS][tT][iI][nN][cC][tT] ;
EXISTS : [eE][xX][iI][sS][tT][sS] ;
// FALSE: see Boolean
FROM : [fF][rR][oO][mM] ;
IN : [iI][nN] ;
KEY : [kK][eE][yY] ;
NEW : [nN][eE][wW] ;            // token rewrite for NEW -> not reserved (also not in SQL)
NOT : [nN][oO][tT] ;
NULL : [nN][uU][lL][lL] ;
OF : [oO][fF] ;
ON : [oO][nN] ;
SELECT : [sS][eE][lL][eE][cC][tT] ;
SOME : [sS][oO][mM][eE] ;
WHEN : [wW][hH][eE][nN] ;
// TRUE: see Boolean
WHERE : [wW][hH][eE][rR][eE] ;
WITH : [wW][iI][tT][hH] ;

// Fixed Token which is defined DIRECTLY BEFORE the unreserved keywords ------

Number                          // DO NOT RENAME OR MOVE THIS RULE !!!
  : [0-9]+                      // no initial sign
    ( '.' [0-9]+ )?
    ( [eE] ('+'|'-')? [0-9]+ )?
  ;

// Unreserved keywords (are case-insensitive): -------------------------------
// Do not add keywords just for specialFunctions!

ABSTRACT : [aA][bB][sS][tT][rR][aA][cC][tT] ;
ACTION : [aA][cC][tT][iI][oO][nN] ;
ACTIONS : [aA][cC][tT][iI][oO][nN][sS] ;
AND : [aA][nN][dD] ;
ANNOTATE : [aA][nN][nN][oO][tT][aA][tT][eE] ;
ANNOTATION : [aA][nN][nN][oO][tT][aA][tT][iI][oO][nN] ;
ARRAY : [aA][rR][rR][aA][yY] ;
ASC : [aA][sS][cC] ;
ASPECT : [aA][sS][pP][eE][cC][tT] ;
ASSOCIATION : [aA][sS][sS][oO][cC][iI][aA][tT][iI][oO][nN] ;
BETWEEN : [bB][eE][tT][wW][eE][eE][nN] ;
COLUMNS : [cC][oO][lL][uU][mM][nN][sS];
COMPOSITION : [cC][oO][mM][pP][oO][sS][iI][tT][iI][oO][nN] ;
CONTEXT : [cC][oO][nN][tT][eE][xX][tT] ;
CROSS : [cC][rR][oO][sS][sS] ;
CURRENT : [cC][uU][rR][rR][eE][nN][tT] ;
DEFAULT : [dD][eE][fF][aA][uU][lL][tT] ;
DEFINE : [dD][eE][fF][iI][nN][eE] ;
DEFINITIONS : [dD][eE][fF][iI][nN][iI][tT][iI][oO][nN][sS] ;
DESC : [dD][eE][sS][cC] ;
// ELEMENT : [eE][lL][eE][mM][eE][nN][tT] ;
ELEMENTS : [eE][lL][eE][mM][eE][nN][tT][sS] ;
ELSE : [eE][lL][sS][eE] ;
END : [eE][nN][dD] ;
ENTITY : [eE][nN][tT][iI][tT][yY] ;
ENUM : [eE][nN][uU][mM] ;
EVENT : [eE][vV][eE][nN][tT] ;
ESCAPE : [eE][sS][cC][aA][pP][eE] ;
EXACT : [eE][xX][aA][cC][tT] ;
EXCEPT : [eE][xX][cC][eE][pP][tT] ;
EXCLUDING : [eE][xX][cC][lL][uU][dD][iI][nN][gG] ;
EXTEND : [eE][xX][tT][eE][nN][dD] ;
FIRST : [fF][iI][rR][sS][tT] ;
FLOATING : [fF][lL][oO][aA][tT][iI][nN][gG] ;
FOLLOWING : [fF][oO][lL][lL][oO][wW][iI][nN][gG] ;
FULL : [fF][uU][lL][lL] ;
FUNCTION : [fF][uU][nN][cC][tT][iI][oO][nN] ;
GROUP : [gG][rR][oO][uU][pP] ;
HAVING : [hH][aA][vV][iI][nN][gG] ;
INNER : [iI][nN][nN][eE][rR] ;
INTERSECT : [iI][nN][tT][eE][rR][sS][eE][cC][tT] ;
INTO : [iI][nN][tT][oO] ;
IS : [iI][sS] ;
JOIN : [jJ][oO][iI][nN] ;
LAST : [lL][aA][sS][tT] ;
LEFT : [lL][eE][fF][tT] ;
LIKE : [lL][iI][kK][eE] ;
LIMIT : [lL][iI][mM][iI][tT] ;
LOCALIZED: [lL][oO][cC][aA][lL][iI][zZ][eE][dD];
MANY : [mM][aA][nN][yY] ;
// MASKED : [mM][aA][sS][kK][eE][dD] ;
MINUS : [mM][iI][nN][uU][sS] ;
MIXIN : [mM][iI][xX][iI][nN] ;
NAMESPACE : [nN][aA][mM][eE][sS][pP][aA][cC][eE] ;
NULLS : [nN][uU][lL][lL][sS] ;
OFFSET : [oO][fF][fF][sS][eE][tT] ;
ONE : [oO][nN][eE] ;
OR : [oO][rR] ;
ORDER : [oO][rR][dD][eE][rR] ;
OUTER : [oO][uU][tT][eE][rR] ;
// OVER : [oO][vV][eE][rR] ;
PARAMETERS : [pP][aA][rR][aA][mM][eE][tT][eE][rR][sS] ;
PARTITION: [pP][aA][rR][tT][iI][tT][iI][oO][nN] ;
PRECEDING: [pP][rR][eE][cC][eE][dD][iI][nN][gG] ;
PROJECTION : [pP][rR][oO][jJ][eE][cC][tT][iI][oO][nN] ;
REDIRECTED : [rR][eE][dD][iI][rR][eE][cC][tT][eE][dD] ;
RETURNS : [rR][eE][tT][uU][rR][nN][sS] ;
RIGHT : [rR][iI][gG][hH][tT] ;
ROW : [rR][oO][wW] ;
ROWS : [rR][oO][wW][sS] ;
SERVICE : [sS][eE][rR][vV][iI][cC][eE] ;
STORED : [sS][tT][oO][rR][eE][dD] ;
THEN : [tT][hH][eE][nN] ;
TO : [tT][oO] ;                 // or make reserved? (is in SQL-92)
TYPE : [tT][yY][pP][eE] ;
UNION : [uU][nN][iI][oO][nN] ;
UNBOUNDED : [uU][nN][bB][oO][uU][nN][dD][eE][dD] ;
UP : [uU][pP] ;
USING : [uU][sS][iI][nN][gG] ;
VARIABLE : [vV][aA][rR][iI][aA][bB][lL][eE] ;
VIEW : [vV][iI][eE][wW] ;
// VIRTUAL: [vV][iI][rR][tT][uU][aA][lL] ; see tokens {}

// Identifiers, must BE LAST, DIRECTLY AFTER the unreserved keywords ---------

Identifier                      // DO NOT RENAME OR MOVE THIS RULE !!!
  : [$_\p{ID_Start}][$\p{ID_Continue}\u200C\u200D]*   // i.e. including $param
  | ( '"' ~[\u0022\n\r\u2028\u2029]* '"' )+ // \u0022 = '"'
  | '![' ~[\u005d\n\r\u2028\u2029]* ']' ( ']' ~[\u005d\n\r\u2028\u2029]* ']' )* // \u005d = ']'
  ;

IllegalToken : . ;

// Local Variables:
// c-basic-offset: 2
// End:
