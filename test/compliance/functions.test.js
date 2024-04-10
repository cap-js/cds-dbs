const cds = require('../cds.js')

describe('functions', () => {
  const { expect, data } = cds.test(__dirname + '/resources')
  data.autoIsolation(true)

  describe('ABAP_ALPHANUM', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('ABAP_DF16RAW_TO_SMALLDECIMAL', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('ABAP_DF34RAW_TO_DECIMAL', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('ABAP_NUMC', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('ABAP_LOWER', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('ABAP_UPPER', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('ABS', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('ACOS', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('ADD_DAYS', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('ADD_MONTHS', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('ADD_MONTHS_LAST', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('ADD_NANO100', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('ADD_SECONDS', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('ADD_WORKDAYS', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('ADD_YEARS', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('ALLOW_PRECISION_LOSS', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('ASCII', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('ASIN', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('ATAN', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('ATAN2', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('AUTO_CORR', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('AVG', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('BINNING', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('BINTOHEX', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('BINTONHEX', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('BINTOSTR', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('BITAND', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('BITCOUNT', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('BITNOT', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('BITOR', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('BITSET', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('BITUNSET', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('BITXOR', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('CARDINALITY', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('CAST', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('CEIL', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('CHAR', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('COALESCE', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('CONCAT', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('CONCAT_NAZ', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('CONVERT_CURRENCY', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('CONVERT_UNIT', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('CORR', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('CORR_SPEARMAN', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('COS', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('COSH', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('COT', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('COUNT', () => {
    test('simple count', async () => {
      const cqn = CQL`SELECT count(1) as count FROM edge.hana.functions.timestamps`
      const res = await cds.run(cqn)
      expect(res[0].count).to.be.eq(1000)
    })
  })
  describe('CROSS_CORR', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('CUBIC_SPLINE_APPROX', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('CUME_DIST', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('CURRENT_CONNECTION', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('CURRENT_DATE', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('CURRENT_IDENTITY_VALUE', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('CURRENT_MVCC_SNAPSHOT_TIMESTAMP', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('CURRENT_OBJECT_SCHEMA', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('CURRENT_SCHEMA', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('CURRENT_SITE_ID', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('CURRENT_TIME', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('CURRENT_TIMESTAMP', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('CURRENT_TRANSACTION_ISOLATION_LEVEL', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('CURRENT_UPDATE_STATEMENT_SEQUENCE', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('CURRENT_UPDATE_TRANSACTION', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('CURRENT_USER', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('CURRENT_USER_ID', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('CURRENT_UTCDATE', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('CURRENT_UTCTIME', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('CURRENT_UTCTIMESTAMP', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('DAYNAME', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('DAYOFMONTH', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('DAYOFYEAR', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('DAYS_BETWEEN', () => {
    test('sqlite vs HANA', async () => {
      const cqn = CQL`SELECT a,b,days,DAYS_BETWEEN(a,b) as sqlite FROM edge.hana.functions.timestamps WHERE days != DAYS_BETWEEN(a,b)`
      const res = await cds.run(cqn)

      if (res.length) {
        throw new Error(
          `Not all results match the results from HANA ${res.length}:\n${res
            .map(r => `DAYS_BETWEEN('${r.a}','${r.b}') received: ${r.sqlite} expected ${r.days}`)
            .join('\n')}`,
        )
      }
    })
  })
  describe('DENSE_RANK', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('DFT', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('ENCRYPTION_ROOT_KEYS_EXTRACT_KEYS', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('ENCRYPTION_ROOT_KEYS_EXTRACT_ALL_KEYS_FOR_DATABASE', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('ENCRYPTION_ROOT_KEYS_HAS_BACKUP_PASSWORD', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('ESCAPE_DOUBLE_QUOTES', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('ESCAPE_SINGLE_QUOTES', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('EXP', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('EXPRESSION_MACRO', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('EXTRACT', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('FIRST_VALUE', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('FLOOR', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('GENERATE_PASSWORD', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('GREATEST', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('GROUPING', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('GROUPING_ID', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('HAMMING_DISTANCE', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('HASH_MD5', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('HASH_SHA256', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('HEXTOBIN', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('HEXTONUM', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('HOUR', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('IFNULL', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('INDEXING_ERROR_CODE', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('INDEXING_ERROR_MESSAGE', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('INDEXING_STATUS', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('INITCAP', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('IS_SQL_INJECTION_SAFE', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('ISOWEEK', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('JSON_QUERY', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('JSON_TABLE', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('JSON_VALUE', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('LAG', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('LANGUAGE', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('LAST_DAY', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('LAST_VALUE', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('LCASE', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('LEAD', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('LEAST', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('LEFT', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('LENGTH', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('LINEAR_APPROX', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('LN', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('LOCALTOUTC', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('LOCATE', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('LOCATE_REGEXPR', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('LOG', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('LOWER', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('LPAD', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('LTRIM', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('MAP', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('MAX', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('MEDIAN', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('MEMBER_AT', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('MIMETYPE', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('MIN', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('MINUTE', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('MOD', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('MONTH', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('MONTHNAME', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('MONTHS_BETWEEN', () => {
    test('sqlite vs HANA', async () => {
      const cqn = CQL`SELECT a,b,months,MONTHS_BETWEEN(a,b) as sqlite FROM edge.hana.functions.timestamps WHERE months != MONTHS_BETWEEN(a,b)`
      const res = await cds.run(cqn)
      if (res.length) {
        throw new Error(
          `Not all results match the results from HANA ${res.length}:\n${res
            .map(r => `MONTHS_BETWEEN('${r.a}','${r.b}') received: ${r.sqlite} expected ${r.months}`)
            .join('\n')}`,
        )
      }
    })
  })
  describe('NANO100_BETWEEN', () => {
    test('sqlite vs HANA', async () => {
      const cqn = CQL`SELECT a,b,nano100,NANO100_BETWEEN(a,b) as sqlite FROM edge.hana.functions.timestamps WHERE nano100 != NANO100_BETWEEN(a,b)`
      const res = await cds.run(cqn)

      const unacceptable = res.filter(r => {
        const diff = r.nano100 - r.sqlite
        // -512 and 512 is the min and max when casting to an integer
        // without cast it diverges -304 or 400 nano100 -> ~40ms
        // Also lots of 0 differences in the result which means that the JS layer is losing some of the accuracy
        return diff < -512 || diff > 512
      })

      if (unacceptable.length) {
        throw new Error(
          `Not all results match the results from HANA ${unacceptable.length}:\n${unacceptable
            .map(r => `NANO100_BETWEEN('${r.a}','${r.b}') received: ${r.sqlite} expected ${r.nano100}`)
            .join('\n')}`,
        )
      }
    })
  })
  describe('NCHAR', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('NDIV0', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('NEXT_DAY', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('NEWUID', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('NORMALIZE', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('NOW', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('NTH_VALUE', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('NTILE', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('NULLIF', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('NUMTOHEX', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('OCCURRENCES_REGEXPR', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('PERCENT_RANK', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('PERCENTILE_CONT', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('PERCENTILE_DISC', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('PLAINTEXT', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('POWER', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('QUARTER', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('RAND', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('RANDOM_PARTITION', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('RAND_SECURE', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('RANK', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('RECORD_COMMIT_TIMESTAMP', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('RECORD_ID', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('REPLACE', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('REPLACE_REGEXPR', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('RESULT_CACHE_ID', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('RESULT_CACHE_REFRESH_TIME', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('RIGHT', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('ROUND', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('RPAD', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('RTRIM', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('ROW_NUMBER', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('SCORE', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('SECOND', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('SECONDS_BETWEEN', () => {
    test('sqlite vs HANA', async () => {
      const cqn = CQL`SELECT a,b,seconds,SECONDS_BETWEEN(a,b) as sqlite FROM edge.hana.functions.timestamps WHERE seconds != SECONDS_BETWEEN(a,b)`
      const res = await cds.run(cqn)

      const unacceptable = res.filter(r => {
        const diff = r.seconds - r.sqlite
        return diff < -1 || diff > 1
      })
      if (unacceptable.length) {
        throw new Error(
          `Not all results match the results from HANA ${unacceptable.length}:\n${unacceptable
            .map(r => `SECONDS_BETWEEN('${r.a}','${r.b}') received: ${r.sqlite} expected ${r.seconds}`)
            .join('\n')}`,
        )
      }
    })
  })
  describe('SERIES_DISAGGREGATE', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('SERIES_ELEMENT_TO_PERIOD', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('SERIES_FILTER', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('SERIES_GENERATE', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('SERIES_PERIOD_TO_ELEMENT', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('SERIES_ROUND', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('SESSION_CONTEXT', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('SESSION_USER', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('SIGN', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('SIN', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('SINH', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('SOUNDEX', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('SQRT', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('STDDEV', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('STDDEV_POP', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('STDDEV_SAMP', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('STRING_AGG', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('STRTOBIN', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('SUBARRAY', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('SUBSTR_AFTER', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('SUBSTR_BEFORE', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('SUBSTRING_REGEXPR', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('SUBSTRING', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('SUM', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('SYSUUID', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('TAN', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('TANH', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('TO_ALPHANUM', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('TO_BIGINT', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('TO_BINARY', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('TO_BLOB', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('TO_BOOLEAN', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('TO_CLOB', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('TO_DATE', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('TO_DATS', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('TO_DECIMAL', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('TO_DOUBLE', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('TO_FIXEDCHAR', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('TO_INT', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('TO_INTEGER', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('undefined', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('TO_NCLOB', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('TO_NVARCHAR', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('TO_REAL', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('TO_SECONDDATE', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('TO_SMALLDECIMAL', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('TO_SMALLINT', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('TO_TIME', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('TO_TIMESTAMP', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('TO_TINYINT', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('TO_VARCHAR', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('TRIM', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('TRIM_ARRAY', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('UCASE', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('UMINUS', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('UNICODE', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('UPPER', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('UTCTOLOCAL', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('VAR', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('VAR_POP', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('VAR_SAMP', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('WEEK', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('WEEKDAY', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('WEIGHTED_AVG', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('WIDTH_BUCKET', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('WORKDAYS_BETWEEN', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('XMLEXTRACT', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('XMLEXTRACTVALUE', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('XMLTABLE', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('YEAR', () => {
    test.skip('missing', () => {
      throw new Error('not supported')
    })
  })
  describe('YEARS_BETWEEN', () => {
    test('sqlite vs HANA', async () => {
      const cqn = CQL`SELECT a,b,years,YEARS_BETWEEN(a,b) as sqlite FROM edge.hana.functions.timestamps WHERE years != YEARS_BETWEEN(a,b)`
      const res = await cds.run(cqn)
      if (res.length) {
        throw new Error(
          `Not all results match the results from HANA ${res.length}:\n${res
            .map(r => `YEARS_BETWEEN('${r.a}','${r.b}') received: ${r.sqlite} expected ${r.years}`)
            .join('\n')}`,
        )
      }
    })
  })
})
