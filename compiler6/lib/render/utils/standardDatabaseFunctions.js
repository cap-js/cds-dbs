'use strict';

/**
 * List of functions for which we provide a mapping to the respective SQL dialect.
 * All functions are lowercase, the caller may treat the function name case-insensitive.
 *
 * The `this` context within the functions hold the `renderArgs` function.
 */
const oDataFunctions = {
  // https://www.sqlite.org/lang_corefunc.html
  sqlite: {
    contains(signature) {
      const { args } = signature;
      checkArgs.call(this, 'contains', args, 2);
      const x = this.renderArgs({ ...signature, args: [ args[0] ] });
      const y = this.renderArgs({ ...signature, args: [ args[1] ] });
      return `(ifnull(instr(${ x }, ${ y }),0) <> 0)`;
    },
    startswith(signature) {
      const { args } = signature;
      checkArgs.call(this, 'startswith', args, 2);
      const x = this.renderArgs({ ...signature, args: [ args[0] ] });
      const y = this.renderArgs({ ...signature, args: [ args[1] ] });
      return `coalesce((instr(${ x }, ${ y }) = 1), false)`;
    }, // instr is 1 indexed
    endswith(signature) {
      const { args } = signature;
      checkArgs.call(this, 'endswith', args, 2);
      const x = this.renderArgs({ ...signature, args: [ args[0] ] });
      const y = this.renderArgs({ ...signature, args: [ args[1] ] });
      return `coalesce((substr(${ x }, length(${ x }) + 1 - length(${ y })) = ${ y }), false)`;
    },
    indexof(signature) {
      const { args } = signature;
      checkArgs.call(this, 'indexof', args, 2);
      const x = this.renderArgs({ ...signature, args: [ args[0] ] });
      const y = this.renderArgs({ ...signature, args: [ args[1] ] });
      return `(instr(${ x }, ${ y }) - 1)`; // instr is 1 indexed
    },
    matchespattern(signature) {
      const { args } = signature;
      checkArgs.call(this, 'matchespattern', args, 2);
      const x = this.renderArgs({ ...signature, args: [ args[0] ] });
      const y = this.renderArgs({ ...signature, args: [ args[1] ] });
      return `cast((${ x } regexp ${ y }) as INTEGER)`; // this is a udf, sqlite always returns a REAL w/o the cast
    },
    matchesPattern(signature) {
      return oDataFunctions.sqlite.matchespattern.call(this, signature);
    },
    year(signature) {
      const { args } = signature;
      checkArgs.call(this, 'year', args, 1);
      const x = this.renderArgs({ ...signature, args: [ args[0] ] });
      return `cast(strftime('%Y', ${ x }) as Integer)`;
    },
    month(signature) {
      const { args } = signature;
      checkArgs.call(this, 'month', args, 1);
      const x = this.renderArgs({ ...signature, args: [ args[0] ] });
      return `cast(strftime('%m', ${ x }) as Integer)`;
    },
    day(signature) {
      const { args } = signature;
      checkArgs.call(this, 'day', args, 1);
      const x = this.renderArgs({ ...signature, args: [ args[0] ] });
      return `cast(strftime('%d', ${ x }) as Integer)`;
    },
    hour(signature) {
      const { args } = signature;
      checkArgs.call(this, 'hour', args, 1);
      const x = this.renderArgs({ ...signature, args: [ args[0] ] });
      return `cast(strftime('%H', ${ x }) as Integer)`;
    },
    minute(signature) {
      const { args } = signature;
      checkArgs.call(this, 'minute', args, 1);
      const x = this.renderArgs({ ...signature, args: [ args[0] ] });
      return `cast(strftime('%M', ${ x }) as Integer)`;
    },
    second(signature) {
      const { args } = signature;
      checkArgs.call(this, 'second', args, 1);
      const x = this.renderArgs({ ...signature, args: [ args[0] ] });
      return `cast(strftime('%S', ${ x }) as Integer)`;
    },
    // REVISIT: currently runtimes normalize to milliseconds
    //          we could allow this to be more precise
    fractionalseconds(signature) {
      const { args } = signature;
      checkArgs.call(this, 'fractionalseconds', args, 1);
      const x = this.renderArgs({ ...signature, args: [ args[0] ] });
      return `cast(substr(strftime('%f', ${ x }), length(strftime('%f', ${ x })) - 3) as REAL)`;
    },
    // The date(), time(), and datetime() functions all return text, and so their strftime() equivalents are exact.
    time(signature) {
      const { args } = signature;
      checkArgs.call(this, 'time', args, 1);
      const x = this.renderArgs({ ...signature, args: [ args[0] ] });
      return `time(${ x })`;
    },
    date(signature) {
      const { args } = signature;
      checkArgs.call(this, 'date', args, 1);
      const x = this.renderArgs({ ...signature, args: [ args[0] ] });
      return `date(${ x })`;
    },
    // this could also be a negative number
    // also, parts of the EDM.duration are optional which complicates
    // the implementation on SQL level. As the parameter may be an element
    // reference, we must do splitting  and casting in the SQL as well as
    // considering the case where the duration is negative.
    // --> We do not support this function.
    // totalseconds(signature) {
    //   const { args } = signature;
    //   checkArgs.call(this, 'totalseconds', args, 1);
    //   let x = this.renderArgs({ ...signature, args: [ args[0] ] });
    //   const isNegative = x.startsWith("'-"); // Check for leading '-'
    //   x = isNegative ? x.replace('-', '') : x; // remove for easier processing
    //   const sql = `((cast(substr(${x},2,instr(${x},'DT') - 2) as Integer) + (julianday('-4713-11-25T' || replace(replace(replace(substr(${x},instr(${x},'DT') + 2),'H',':'),'M',':'),'S','Z')) - 0.5)) * 86400)`;
    //   return isNegative ? `-(${sql})` : sql;
    // },
  },
  // https://www.postgresql.org/docs/current/functions-string.html
  // https://www.postgresql.org/docs/current/functions-math.html
  postgres: {
    contains(signature) {
      const { args } = signature;
      checkArgs.call(this, 'contains', args, 2);
      const x = this.renderArgs({ ...signature, args: [ args[0] ] });
      const y = this.renderArgs({ ...signature, args: [ args[1] ] });
      return `(coalesce(strpos(${ x }, ${ y }),0) > 0)`;
    },
    startswith(signature) {
      const { args } = signature;
      checkArgs.call(this, 'startswith', args, 2);
      const x = this.renderArgs({ ...signature, args: [ args[0] ] });
      const y = this.renderArgs({ ...signature, args: [ args[1] ] });
      return `coalesce((strpos(${ x }, ${ y }) = 1), false)`; // strpos is 1 indexed
    },
    endswith(signature) {
      const { args } = signature;
      checkArgs.call(this, 'endswith', args, 2);
      const x = this.renderArgs({ ...signature, args: [ args[0] ] });
      const y = this.renderArgs({ ...signature, args: [ args[1] ] });
      return `coalesce((substr(${ x }, (length(${ x }) + 1) - length(${ y })) = ${ y }), false)`;
    },
    indexof(signature) {
      const { args } = signature;
      checkArgs.call(this, 'indexof', args, 2);
      const x = this.renderArgs({ ...signature, args: [ args[0] ] });
      const y = this.renderArgs({ ...signature, args: [ args[1] ] });
      return `(strpos(${ x }, ${ y }) - 1)`; // strpos is 1 indexed
    },
    matchespattern(signature) {
      const { args } = signature;
      checkArgs.call(this, 'matchespattern', args, 2);
      const x = this.renderArgs({ ...signature, args: [ args[0] ] });
      const y = this.renderArgs({ ...signature, args: [ args[1] ] });
      return `regexp_like(${ x }, ${ y })`;
    },
    matchesPattern(signature) {
      return oDataFunctions.postgres.matchespattern.call(this, signature);
    },
    // TODO: PG docu recommends to use the "EXTRACT" function for improved precision
    // https://www.postgresql.org/docs/current/functions-datetime.html#FUNCTIONS-DATETIME-EXTRACT
    year(signature) {
      const { args } = signature;
      checkArgs.call(this, 'year', args, 1);
      const x = this.renderArgs({ ...signature, args: [ args[0] ] });
      return `cast(date_part('year', ${ x }) as Integer)`;
    },
    month(signature) {
      const { args } = signature;
      checkArgs.call(this, 'month', args, 1);
      const x = this.renderArgs({ ...signature, args: [ args[0] ] });
      return `cast(date_part('month', ${ x }) as Integer)`;
    },
    day(signature) {
      const { args } = signature;
      checkArgs.call(this, 'day', args, 1);
      const x = this.renderArgs({ ...signature, args: [ args[0] ] });
      return `cast(date_part('day', ${ x }) as Integer)`;
    },
    hour(signature) {
      const { args } = signature;
      checkArgs.call(this, 'hour', args, 1);
      const x = this.renderArgs({ ...signature, args: [ args[0] ] });
      return `cast(date_part('hour', ${ x }) as Integer)`;
    },
    minute(signature) {
      const { args } = signature;
      checkArgs.call(this, 'minute', args, 1);
      const x = this.renderArgs({ ...signature, args: [ args[0] ] });
      return `cast(date_part('minute', ${ x }) as Integer)`;
    },
    second(signature) {
      const { args } = signature;
      checkArgs.call(this, 'second', args, 1);
      const x = this.renderArgs({ ...signature, args: [ args[0] ] });
      return `cast(floor(date_part('second', ${ x })) as Integer)`;
    },
    // REVISIT: currently runtimes normalize to milliseconds
    //          we could allow this to be more precise
    fractionalseconds(signature) {
      const { args } = signature;
      checkArgs.call(this, 'fractionalseconds', args, 1);
      const x = this.renderArgs({ ...signature, args: [ args[0] ] });
      return `cast(date_part('second', ${ x }) - floor(date_part('second', ${ x })) AS DECIMAL(3,3))`;
    },
    time(signature) {
      const { args } = signature;
      checkArgs.call(this, 'time', args, 1);
      const x = this.renderArgs({ ...signature, args: [ args[0] ] });
      return `to_char(${ x }, 'HH24:MI:SS')::TIME`;
    },
    date(signature) {
      const { args } = signature;
      checkArgs.call(this, 'date', args, 1);
      const x = this.renderArgs({ ...signature, args: [ args[0] ] });
      return `${ x }::DATE`;
    },
  },
  // https://help.sap.com/docs/HANA_SERVICE_CF/7c78579ce9b14a669c1f3295b0d8ca16/f12b86a6284c4aeeb449e57eb5dd3ebd.html?locale=en-US
  hana: {
    contains(signature) {
      const { args } = signature;
      checkArgs.call(this, 'contains', args, 2, 3);
      const x = this.renderArgs({ ...signature, args: [ args[0] ] });
      const y = this.renderArgs({ ...signature, args: [ args[1] ] });
      if (signature.args.length > 2) {
        const z = this.renderArgs({ ...signature, args: [ args[2] ] });
        // While CONTAINS() looks like a function because of its syntax,
        // it is classified as a predicate because it is designed to evaluate a condition
        // and return a Boolean result.
        return `CONTAINS(${ x }, ${ y }, ${ z })`;
      }

      return `(CASE WHEN coalesce(locate(${ this.renderArgs(signature) }),0)>0 THEN TRUE ELSE FALSE END)`;
    },
    startswith(signature) {
      const { args } = signature;
      checkArgs.call(this, 'startswith', args, 2);
      const x = this.renderArgs({ ...signature, args: [ args[0] ] });
      const y = this.renderArgs({ ...signature, args: [ args[1] ] });
      return `(CASE WHEN locate(${ x }, ${ y }) = 1 THEN TRUE ELSE FALSE END)`;
    }, // locate is 1 indexed
    endswith(signature) {
      const { args } = signature;
      checkArgs.call(this, 'endswith', args, 2);
      const x = this.renderArgs({ ...signature, args: [ args[0] ] });
      const y = this.renderArgs({ ...signature, args: [ args[1] ] });
      return `(CASE WHEN substring(${ x }, (length(${ x }) + 1) - length(${ y })) = ${ y } THEN TRUE ELSE FALSE END)`;
    },
    indexof(signature) {
      const { args } = signature;
      checkArgs.call(this, 'indexof', args, 2);
      const x = this.renderArgs({ ...signature, args: [ args[0] ] });
      const y = this.renderArgs({ ...signature, args: [ args[1] ] });
      return `(locate(${ x }, ${ y }) - 1)`; // locate is 1 indexed
    },
    matchespattern(signature) {
      // case … when only works as column expression (not in where)
      // in the where clause, only "${x} LIKE_REGEXPR ${y}" works
      const { args } = signature;
      checkArgs.call(this, 'matchespattern', args, 2);
      const x = this.renderArgs({ ...signature, args: [ args[0] ] });
      const y = this.renderArgs({ ...signature, args: [ args[1] ] });
      return `(CASE WHEN ${ x } LIKE_REGEXPR ${ y } THEN TRUE ELSE FALSE END)`;
    },
    matchesPattern(signature) {
      return oDataFunctions.hana.matchespattern.call(this, signature);
    },
    year(signature) {
      const { args } = signature;
      checkArgs.call(this, 'year', args, 1);
      const x = this.renderArgs({ ...signature, args: [ args[0] ] });
      return `year(${ x })`;
    },
    month(signature) {
      const { args } = signature;
      checkArgs.call(this, 'month', args, 1);
      const x = this.renderArgs({ ...signature, args: [ args[0] ] });
      return `month(${ x })`;
    },
    day(signature) {
      const { args } = signature;
      checkArgs.call(this, 'day', args, 1);
      const x = this.renderArgs({ ...signature, args: [ args[0] ] });
      return `dayofmonth(${ x })`;
    },
    hour(signature) {
      const { args } = signature;
      checkArgs.call(this, 'hour', args, 1);
      const x = this.renderArgs({ ...signature, args: [ args[0] ] });
      return `hour(${ x })`;
    },
    minute(signature) {
      const { args } = signature;
      checkArgs.call(this, 'minute', args, 1);
      const x = this.renderArgs({ ...signature, args: [ args[0] ] });
      return `minute(${ x })`;
    },
    second(signature) {
      const { args } = signature;
      checkArgs.call(this, 'second', args, 1);
      const x = this.renderArgs({ ...signature, args: [ args[0] ] });
      return `to_integer(second(${ x }))`;
    },
    // REVISIT: currently runtimes normalize to milliseconds
    //          we could allow this to be more precise
    fractionalseconds(signature) {
      const { args } = signature;
      checkArgs.call(this, 'fractionalseconds', args, 1);
      const x = this.renderArgs({ ...signature, args: [ args[0] ] });
      return `(to_decimal(second(${ x }),5,3) - to_integer(second(${ x })))`;
    },
    time(signature) {
      const { args } = signature;
      checkArgs.call(this, 'time', args, 1);
      const x = this.renderArgs({ ...signature, args: [ args[0] ] });
      return `to_time(${ x })`;
    },
    date(signature) {
      const { args } = signature;
      checkArgs.call(this, 'date', args, 1);
      const x = this.renderArgs({ ...signature, args: [ args[0] ] });
      return `to_date(${ x })`;
    },
  },
  // https://www.h2database.com/html/functions.html
  h2: {
    contains(signature) {
      const args = [ ...signature.args ];
      checkArgs.call(this, 'contains', args, 2);
      // defined as { LOCATE(searchString, string [, startInt]) }
      args.reverse();
      const x = this.renderArgs({ ...signature, args: [ args[0] ] });
      const y = this.renderArgs({ ...signature, args: [ args[1] ] });
      return `(coalesce(locate(${ x }, ${ y }),0) > 0)`;
    },
    startswith(signature) {
      const args = [ ...signature.args ];
      checkArgs.call(this, 'startswith', args, 2);
      // defined as { LOCATE(searchString, string [, startInt]) }
      args.reverse();
      const x = this.renderArgs({ ...signature, args: [ args[0] ] });
      const y = this.renderArgs({ ...signature, args: [ args[1] ] });
      return `coalesce((locate(${ x }, ${ y }) = 1), false)`; // locate is 1 indexed
    },
    endswith(signature) {
      const { args } = signature;
      checkArgs.call(this, 'endswith', args, 2);
      const x = this.renderArgs({ ...signature, args: [ args[0] ] });
      const y = this.renderArgs({ ...signature, args: [ args[1] ] });
      return `coalesce((substring(${ x } FROM (char_length(${ x }) + 1) - char_length(${ y })) = ${ y }), false)`;
    },
    substring(signature) {
      const { args } = signature;
      checkArgs.call(this, 'substring', args, 2, 3);
      const x = this.renderArgs({ ...signature, args: [ args[0] ] });
      const y = this.renderArgs({ ...signature, args: [ args[1] ] });
      const z = args[2]
        ? this.renderArgs({ ...signature, args: [ args[2] ] })
        : null;
      return z
        ? `substring(${ x } FROM CASE WHEN ${ y } < 0 THEN char_length(${ x }) + ${ y } + 1 ELSE ${ y } + 1 END FOR ${ z })`
        : `substring(${ x } FROM CASE WHEN ${ y } < 0 THEN char_length(${ x }) + ${ y } + 1 ELSE ${ y } + 1 END)`;
    },
    // char_length is preferred over length -> REVISIT: returns a BIGINT, is this ok?
    // https://www.h2database.com/html/functions.html#char_length
    length(signature) {
      const { args } = signature;
      checkArgs.call(this, 'length', args, 1);
      const x = this.renderArgs({ ...signature, args: [ args[0] ] });
      return `cast(char_length(${ x }) as Integer)`;
    },
    indexof(signature) {
      const args = [ ...signature.args ];
      checkArgs.call(this, 'indexof', args, 2);
      // defined as { LOCATE(searchString, string [, startInt]) }
      args.reverse();
      const x = this.renderArgs({ ...signature, args: [ args[0] ] });
      const y = this.renderArgs({ ...signature, args: [ args[1] ] });
      return `(locate(${ x }, ${ y }) - 1)`; // locate is 1 indexed
    },
    matchespattern(signature) {
      const { args } = signature;
      checkArgs.call(this, 'matchespattern', args, 2);
      const x = this.renderArgs({ ...signature, args: [ args[0] ] });
      const y = this.renderArgs({ ...signature, args: [ args[1] ] });
      return `regexp_like(${ x }, ${ y })`;
    },
    matchesPattern(signature) {
      return oDataFunctions.h2.matchespattern.call(this, signature);
    },
    year(signature) {
      const { args } = signature;
      checkArgs.call(this, 'year', args, 1);
      const x = this.renderArgs({ ...signature, args: [ args[0] ] });
      return `extract(YEAR FROM ${ x })`;
    },
    month(signature) {
      const { args } = signature;
      checkArgs.call(this, 'month', args, 1);
      const x = this.renderArgs({ ...signature, args: [ args[0] ] });
      return `extract(MONTH FROM ${ x })`;
    },
    day(signature) {
      const { args } = signature;
      checkArgs.call(this, 'day', args, 1);
      const x = this.renderArgs({ ...signature, args: [ args[0] ] });
      return `extract(DAY FROM ${ x })`;
    },
    hour(signature) {
      const { args } = signature;
      checkArgs.call(this, 'hour', args, 1);
      const x = this.renderArgs({ ...signature, args: [ args[0] ] });
      return `extract(HOUR FROM ${ x })`;
    },
    minute(signature) {
      const { args } = signature;
      checkArgs.call(this, 'minute', args, 1);
      const x = this.renderArgs({ ...signature, args: [ args[0] ] });
      return `extract(MINUTE FROM ${ x })`;
    },
    second(signature) {
      const { args } = signature;
      checkArgs.call(this, 'second', args, 1);
      const x = this.renderArgs({ ...signature, args: [ args[0] ] });
      return `extract(SECOND FROM ${ x })`;
    },
    // REVISIT: currently runtimes normalize to milliseconds
    //          we could allow this to be more precise
    fractionalseconds(signature) {
      const { args } = signature;
      checkArgs.call(this, 'fractionalseconds', args, 1);
      const x = this.renderArgs({ ...signature, args: [ args[0] ] });
      return `cast(extract(MILLISECOND FROM ${ x }) / 1000.0 AS NUMERIC(3,3))`;
    },
    time(signature) {
      const { args } = signature;
      checkArgs.call(this, 'time', args, 1);
      const x = this.renderArgs({ ...signature, args: [ args[0] ] });
      return `cast(${ x } AS TIME)`;
    },
    date(signature) {
      const { args } = signature;
      checkArgs.call(this, 'date', args, 1);
      const x = this.renderArgs({ ...signature, args: [ args[0] ] });
      return `cast(${ x } AS DATE)`;
    },
  },
  common: {
    concat(signature) {
      const separator = '||';
      const args = signature.args.reduce((acc, current, index) => {
        if (index > 0)
          acc.push(separator);

        acc.push(current);
        return acc;
      }, []);
      const res = this.renderArgs({ signature, ...{ args: [ args ] } });
      return `(${ res })`;
    },
    ceiling(signature) {
      const { args } = signature;
      checkArgs.call(this, 'ceiling', args, 1);
      const x = this.renderArgs({ ...signature, args: [ args[0] ] });
      return `ceil(${ x })`;
    },
    floor(signature) {
      const { args } = signature;
      checkArgs.call(this, 'floor', args, 1);
      const x = this.renderArgs({ ...signature, args: [ args[0] ] });
      return `floor(${ x })`;
    },
    trim(signature) {
      const { args } = signature;
      checkArgs.call(this, 'trim', args, 1);
      const x = this.renderArgs({ ...signature, args: [ args[0] ] });
      return `trim(${ x })`;
    },
    // SAP HANA, sqlite and postgres share the same implementation
    substring(signature) {
      const { args } = signature;
      checkArgs.call(this, 'substring', args, 2, 3);
      const x = this.renderArgs({ ...signature, args: [ args[0] ] });
      const y = this.renderArgs({ ...signature, args: [ args[1] ] });
      const z = args[2]
        ? this.renderArgs({ ...signature, args: [ args[2] ] })
        : null;
      return z
        ? `substr(${ x }, CASE WHEN ${ y } < 0 THEN length(${ x }) + ${ y } + 1 ELSE ${ y } + 1 END, ${ z })`
        : `substr(${ x }, CASE WHEN ${ y } < 0 THEN length(${ x }) + ${ y } + 1 ELSE ${ y } + 1 END)`;
    },
    min(signature) {
      const { args } = signature;
      checkArgs.call(this, 'min', args, 1);
      const x = this.renderArgs({ ...signature, args: [ args[0] ] });
      return `min(${ x })`;
    },
    max(signature) {
      const { args } = signature;
      checkArgs.call(this, 'max', args, 1);
      const x = this.renderArgs({ ...signature, args: [ args[0] ] });
      return `max(${ x })`;
    },
    sum(signature) {
      const { args } = signature;
      checkArgs.call(this, 'sum', args, 1);
      const x = this.renderArgs({ ...signature, args: [ args[0] ] });
      return `sum(${ x })`;
    },
    count(signature) {
      const { args } = signature;
      const x = this.renderArgs({ ...signature, args: [ args[0] ] });
      return `count(${ x || '*' })`;
    },
    countdistinct(signature) {
      const { args } = signature;
      return `count(distinct ${ args.length > 0 ? this.renderArgs(signature) : "'*'" })`;
    },
    average(signature) {
      const { args } = signature;
      checkArgs.call(this, 'average', args, 1);
      const x = this.renderArgs({ ...signature, args: [ args[0] ] });
      return `avg(${ x })`;
    },
    length(signature) {
      const { args } = signature;
      checkArgs.call(this, 'length', args, 1);
      const x = this.renderArgs({ ...signature, args: [ args[0] ] });
      return `length(${ x })`;
    },
    tolower(signature) {
      const { args } = signature;
      checkArgs.call(this, 'tolower', args, 1);
      const x = this.renderArgs({ ...signature, args: [ args[0] ] });
      return `lower(${ x })`;
    },
    toupper(signature) {
      const { args } = signature;
      checkArgs.call(this, 'toupper', args, 1);
      const x = this.renderArgs({ ...signature, args: [ args[0] ] });
      return `upper(${ x })`;
    },
    // eslint-disable-next-line no-unused-vars
    maxdatetime(signature) {
      return "'9999-12-31T23:59:59.999Z'";
    },
    // eslint-disable-next-line no-unused-vars
    mindatetime(signature) {
      return "'0001-01-01T00:00:00.000Z'";
    },
  },
};

const hanaFunctions = {
  sqlite: {
    /**
     * SQLite relies on floating-point arithmetic for date/time calculations, which can introduce
     * slight imprecisions due to the use of the `julianday` function. The `julianday` function
     * computes the difference between two timestamps as a floating-point value in days, which
     * is then scaled to nano100 units (0.1 microseconds). While this approach is efficient,
     * the inherent precision limits of floating-point arithmetic can result in small deviations
     * (e.g., off by a few nano100 units).
     *
     * @param {Object} signature - The function signature containing arguments.
     * @returns {string} - SQL expression to calculate the nano100 difference in SQLite.
     */
    nano100_between(signature) {
      const { args } = signature;
      checkArgs.call(this, 'nano100_between', args, 2);
      const x = this.renderArgs({ ...signature, args: [ args[0] ] });
      const y = this.renderArgs({ ...signature, args: [ args[1] ] });
      // 1 day = 24h*60m*60s*10'000'000 = 864'000'000'000 nano100
      return `CAST(((julianday(${ y }) - julianday(${ x })) * 864000000000) as INTEGER)`;
    },
    seconds_between(signature) {
      const { args } = signature;
      checkArgs.call(this, 'seconds_between', args, 2);
      const x = this.renderArgs({ ...signature, args: [ args[0] ] });
      const y = this.renderArgs({ ...signature, args: [ args[1] ] });

      return `CAST(strftime('%s', ${ y }) - strftime('%s', ${ x }) AS INTEGER)`;
    },
    days_between(signature) {
      const { args } = signature;
      checkArgs.call(this, 'days_between', args, 2);
      const x = this.renderArgs({ ...signature, args: [ args[0] ] });
      const y = this.renderArgs({ ...signature, args: [ args[1] ] });

      return `(CASE WHEN (strftime('%s', ${ y }) - strftime('%s', ${ x })) < 86400 AND (strftime('%s', ${ y }) - strftime('%s', ${ x })) > -86400 THEN 0 ELSE CAST((strftime('%s', ${ y }) - strftime('%s', ${ x })) / 86400 AS INTEGER) END)`;
    },
    /**
     * Calculates the difference in months between two dates, `x` and `y`, with a correction for partial months.
     *
     * The computation consists of:
     *
     * 1. Year/Month Difference:
     *    - Extracts the year and month parts from both dates and computes a raw difference:
     *      (year(y) - year(x)) * 12 + (month(y) - month(x)).
     *
     * 2. Partial-Month Correction:
     *    - Generates a composite value of day and time components from each date using:
     *      strftime('%d%H%M%S%f0000', date)
     *      This zero-padded composite includes day, hour, minute, second, and fractional seconds.
     *    - For a forward interval (when y is after or equal to x):
     *         If the composite for y is less than that for x, then the final month is incomplete, so subtract 1.
     *    - For a backward interval (when y is before x):
     *         If the composite for y is greater than that for x, then the final month is incomplete, so add 1.
     *
     * 3. Leap-Year Adjustment:
     *    - The composite value inherently captures all day/time details (including the leap day, Feb 29),
     *      so the extra day in a leap year is automatically accounted for in the partial-month correction.
     *
     * @param {object} signature - Contains the function arguments.
     * @returns {string} A SQL expression that calculates the adjusted month difference.
     */
    months_between(signature) {
      // Ensure exactly two arguments (startDate, endDate)
      checkArgs.call(this, 'months_between', signature.args, 2);

      // Render the arguments as SQL expressions.
      const x = this.renderArgs({ ...signature, args: [ signature.args[0] ] });
      const y = this.renderArgs({ ...signature, args: [ signature.args[1] ] });

      // Construct the SQL expression:
      // 1. Base month difference from the year and month components.
      // 2. Partial-month correction using a composite integer of day and time.
      const res = `
        (
          (
            (CAST(strftime('%Y', ${ y }) AS Integer) - CAST(strftime('%Y', ${ x }) AS Integer)) * 12
          )
          +
          (
            CAST(strftime('%m', ${ y }) AS Integer) - CAST(strftime('%m', ${ x }) AS Integer)
          )
          +
          (
            CASE
              /* For backward intervals: if the composite (day + time) of y is greater than x, add 1. */
              WHEN CAST(strftime('%Y%m', ${ y }) AS Integer) < CAST(strftime('%Y%m', ${ x }) AS Integer)
                THEN (CAST(strftime('%d%H%M%S%f0000', ${ y }) AS Integer) > CAST(strftime('%d%H%M%S%f0000', ${ x }) AS Integer))
              /* For forward intervals: if the composite of y is less than x, subtract 1. */
              ELSE (CAST(strftime('%d%H%M%S%f0000', ${ y }) AS Integer) < CAST(strftime('%d%H%M%S%f0000', ${ x }) AS Integer)) * -1
            END
          )
        )
      `;
      // Remove extra whitespace and return the single-line SQL expression.
      return res.replace(/\s+/g, ' ');
    },
    years_between(signature) {
      const { args } = signature;
      checkArgs.call(this, 'years_between', args, 2);
      return `floor((${ hanaFunctions.sqlite.months_between.call(this, signature) }) / 12)`;
    },
  },
  postgres: {
    nano100_between(signature) {
      const { args } = signature;
      checkArgs.call(this, 'nano100_between', args, 2);
      const x = this.renderArgs({ ...signature, args: [ args[0] ] });
      const y = this.renderArgs({ ...signature, args: [ args[1] ] });
      // make sure to cast NUMERIC to BIGINT (corresponds to cds.Int64)
      return `(EXTRACT(EPOCH FROM (${ y }) - (${ x })) * 10000000)::BIGINT`;
    },
    seconds_between(signature) {
      const { args } = signature;
      checkArgs.call(this, 'seconds_between', args, 2);
      const x = this.renderArgs({ ...signature, args: [ args[0] ] });
      const y = this.renderArgs({ ...signature, args: [ args[1] ] });

      return `EXTRACT(EPOCH FROM (${ y }) - (${ x }))::BIGINT`;
    },
    days_between(signature) {
      const { args } = signature;
      checkArgs.call(this, 'days_between', args, 2);
      const x = this.renderArgs({ ...signature, args: [ args[0] ] });
      const y = this.renderArgs({ ...signature, args: [ args[1] ] });
      return `EXTRACT(DAY FROM ${ y }::timestamp - ${ x }::timestamp)::integer`;
    },
    months_between(signature) {
      const { args } = signature;
      checkArgs.call(this, 'months_between', args, 2);
      const x = this.renderArgs({ ...signature, args: [ args[0] ] });
      const y = this.renderArgs({ ...signature, args: [ args[1] ] });

      return `(EXTRACT(YEAR FROM AGE(${ y }, ${ x })) * 12 + EXTRACT(MONTH FROM AGE(${ y }, ${ x })))::INTEGER`;
    },
    years_between(signature) {
      const { args } = signature;
      checkArgs.call(this, 'years_between', args, 2);
      return `floor((${ hanaFunctions.postgres.months_between.call(this, signature) }) / 12)::INTEGER`;
    },
  },
  h2: {
    nano100_between(signature) {
      const { args } = signature;
      checkArgs.call(this, 'nano100_between', args, 2);
      const x = this.renderArgs({ ...signature, args: [ args[0] ] });
      const y = this.renderArgs({ ...signature, args: [ args[1] ] });

      return `CAST(DATEDIFF('MICROSECOND', ${ x }, ${ y }) * 10 AS BIGINT)`;
    },
    seconds_between(signature) {
      const { args } = signature;
      checkArgs.call(this, 'seconds_between', args, 2);
      const x = this.renderArgs({ ...signature, args: [ args[0] ] });
      const y = this.renderArgs({ ...signature, args: [ args[1] ] });

      return `CAST(DATEDIFF('SECOND', ${ x }, ${ y }) AS BIGINT)`;
    },
    days_between(signature) {
      const { args } = signature;
      checkArgs.call(this, 'days_between', args, 2);
      const x = this.renderArgs({ ...signature, args: [ args[0] ] });
      const y = this.renderArgs({ ...signature, args: [ args[1] ] });
      return `CASE WHEN ABS(DATEDIFF('SECOND', ${ x }, ${ y })) < 86400 THEN 0 ELSE CAST(FLOOR(DATEDIFF('SECOND', ${ x }, ${ y }) / 86400) AS INTEGER) END`;
    },
    /**
     * Uses DATEDIFF('MONTH') and then applies a partial-month correction for day-of-month boundaries in both
     * forward and backward (negative) scenarios.
     */
    months_between(signature) {
      const { args } = signature;
      checkArgs.call(this, 'months_between', args, 2);

      const x = this.renderArgs({ ...signature, args: [ args[0] ] });
      const y = this.renderArgs({ ...signature, args: [ args[1] ] });

      const res = `
        CAST(
          DATEDIFF('MONTH', ${ x }, ${ y })
          + CASE
              WHEN DATEDIFF('DAY', ${ x }, ${ y }) >= 0
                   AND EXTRACT(DAY FROM ${ y }) < EXTRACT(DAY FROM ${ x })
              THEN -1
    
              WHEN DATEDIFF('DAY', ${ x }, ${ y }) < 0
                   AND EXTRACT(DAY FROM ${ y }) > EXTRACT(DAY FROM ${ x })
              THEN 1
    
              ELSE 0
            END
          AS INTEGER
        )
      `;
      return res.replace(/\s+/g, ' ');
    },
    years_between(signature) {
      const { args } = signature;
      checkArgs.call(this, 'years_between', args, 2);
      return `floor((${ hanaFunctions.h2.months_between.call(this, signature) }) / 12)`;
    },
  },
  common: {},
  // identity functions + argument check
  hana: {
    nano100_between(signature) {
      const { args } = signature;
      checkArgs.call(this, 'nano100_between', args, 2);
      const x = this.renderArgs({ ...signature, args: [ args[0] ] });
      const y = this.renderArgs({ ...signature, args: [ args[1] ] });

      return `nano100_between(${ x }, ${ y })`;
    },
    seconds_between(signature) {
      const { args } = signature;
      checkArgs.call(this, 'seconds_between', args, 2);
      const x = this.renderArgs({ ...signature, args: [ args[0] ] });
      const y = this.renderArgs({ ...signature, args: [ args[1] ] });

      return `seconds_between(${ x }, ${ y })`;
    },
    days_between(signature) {
      const { args } = signature;
      checkArgs.call(this, 'days_between', args, 2);
      const x = this.renderArgs({ ...signature, args: [ args[0] ] });
      const y = this.renderArgs({ ...signature, args: [ args[1] ] });
      return `days_between(${ x }, ${ y })`;
    },
    months_between(signature) {
      const { args } = signature;
      checkArgs.call(this, 'months_between', args, 2);
      const x = this.renderArgs({ ...signature, args: [ args[0] ] });
      const y = this.renderArgs({ ...signature, args: [ args[1] ] });

      return `months_between(${ x }, ${ y })`;
    },
    years_between(signature) {
      const { args } = signature;
      checkArgs.call(this, 'years_between', args, 2);
      return `years_between(${ this.renderArgs(signature) })`;
    },
  },
};

function checkArgs( funcName, receivedArgs, expectedLength, alternativeLength = null ) {
  const expectedMismatch = receivedArgs.length < expectedLength;
  const alternativeMismatch
    = expectedMismatch &&
    (!alternativeLength ||
      (alternativeLength && receivedArgs.length < alternativeLength));
  if (expectedMismatch && alternativeMismatch) {
    this.error('def-missing-argument', [ ...this.path, 'args' ], {
      '#': alternativeLength ? 'alternative' : 'std',
      n: expectedLength,
      m: alternativeLength,
      literal: receivedArgs.length,
      name: funcName,
    });
  }
}

module.exports.standardDatabaseFunctions = {
  sqlite: { ...oDataFunctions.sqlite, ...hanaFunctions.sqlite },
  postgres: { ...oDataFunctions.postgres, ...hanaFunctions.postgres },
  hana: { ...oDataFunctions.hana, ...hanaFunctions.hana },
  h2: { ...oDataFunctions.h2, ...hanaFunctions.h2 },
  common: { ...oDataFunctions.common },
};
