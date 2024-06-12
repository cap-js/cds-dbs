const cds = require('@sap/cds')

if (!cds.env.fiori.lean_draft) {
  throw new Error('"@cap-js/hana" only works if cds.fiori.lean_draft is enabled. Please adapt your configuration.')
}

if (cds.requires.db?.impl === '@cap-js/hana') {
  cds.env.sql.dialect = 'hana'
}

// monkey patch as not extendable as class
const compiler_to_hdi = cds.compiler.to.hdi
cds.compiler.to.hdi = function capjs_compile_hdi(...args) {
  const artifacts = compiler_to_hdi(...args)
  artifacts['ISO.hdbfunction'] = 
  `CREATE OR REPLACE FUNCTION ISO(RAW NVARCHAR(36))
    RETURNS RET TIMESTAMP LANGUAGE SQLSCRIPT AS
    BEGIN
      DECLARE REGEXP NVARCHAR(255);
      DECLARE TIMEZONE NVARCHAR(36);
      DECLARE MULTIPLIER INTEGER;
      DECLARE HOURS INTEGER;
      DECLARE MINUTES INTEGER;
      REGEXP := '(([-+])([[:digit:]]{2}):?([[:digit:]]{2})?|Z)$';
      TIMEZONE := SUBSTR_REGEXPR(:REGEXP IN RAW GROUP 1);
      RET := TO_TIMESTAMP(RAW);
      IF :TIMEZONE = 'Z' OR :TIMEZONE IS NULL THEN
        RETURN;
      END IF;
      MULTIPLIER := TO_INTEGER(SUBSTR_REGEXPR(:REGEXP IN TIMEZONE GROUP 2) || '1');
      HOURS := TO_INTEGER(SUBSTR_REGEXPR(:REGEXP IN TIMEZONE GROUP 3));
      MINUTES := COALESCE(TO_INTEGER(SUBSTR_REGEXPR(:REGEXP IN TIMEZONE GROUP 4)),0);
      RET := ADD_SECONDS(:RET, (HOURS * 60 + MINUTES) * 60 * MULTIPLIER * -1);
    END;`

  return artifacts
}

// TODO: we can override cds.compile.to.sql/.delta in a similar fashion for our tests
