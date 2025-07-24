const cds = require('../../test/cds')

let schema

async function createProcedures() {

  const rs = await cds.run('SELECT CURRENT_SCHEMA "current schema" FROM DUMMY')
  schema = rs[0]['current schema']

  const procs = [
    `CREATE PROCEDURE "procTest0" ( OUT TEST_1 TABLE ( TEST_1_COL_1 NVARCHAR(32) ), OUT TEST_2 NVARCHAR(32) ) AS
    BEGIN TEST_1 = SELECT '1' AS TEST_1_COL_1 FROM DUMMY; TEST_2 = '2'; END`,

    `CREATE PROCEDURE PROC_TEST_1 ( OUT TEST_1 TABLE ( TEST_1_COL_1 NVARCHAR(32) ), IN VAL_2 NVARCHAR(32), OUT TEST_2 TABLE ( TEST_2_COL_1 NVARCHAR(32) ), INOUT VAL_1 NVARCHAR(32) ) AS
    BEGIN TEST_1 = SELECT VAL_1 AS TEST_1_COL_1 FROM DUMMY; TEST_2 = SELECT VAL_2 AS TEST_2_COL_1 FROM DUMMY; END`,

    `CREATE PROCEDURE PROC_TEST_2 ( OUT TEST_1 TABLE ( TEST_1_COL_1 NVARCHAR(32) ), IN VAL_2 NVARCHAR(32), OUT TEST_2 NVARCHAR(32), INOUT VAL_1 NVARCHAR(32) ) AS
    BEGIN TEST_1 = SELECT VAL_1 AS TEST_1_COL_1 FROM DUMMY; TEST_2 = VAL_2; END`,

    `CREATE PROCEDURE PROC_TEST_3 ( OUT TEST_1 NVARCHAR(32), IN VAL_2 NVARCHAR(32), OUT TEST_2 NVARCHAR(32), INOUT VAL_1 NVARCHAR(32) ) AS
    BEGIN TEST_1 = VAL_1; TEST_2 = VAL_2; END`,

    `CREATE PROCEDURE ";sap. secmon~analysis#framework!pattern@getNewAndExistingAlerts" ( OUT TEST_1 NVARCHAR(32), IN VAL_2 NVARCHAR(32), OUT TEST_2 NVARCHAR(32), INOUT VAL_1 NVARCHAR(32) ) AS
    BEGIN TEST_1 = VAL_1; TEST_2 = VAL_2; END`,

    `CREATE PROCEDURE "PROC_TEST_4" (
        OUT TEST_1 TABLE ( ID INTEGER, "title" NVARCHAR(32) ),
        INOUT TEST_3 INTEGER,
        OUT TEST_2 TABLE ( ID INTEGER, "title" NVARCHAR(32) ),
        INOUT VAL_1 INTEGER
      ) AS BEGIN
        TEST_1 = SELECT ID, TITLE as "title" FROM sap_capire_TestEntity WHERE ID <= :VAL_1;
        TEST_2 = SELECT ID, TITLE as "title" FROM sap_capire_TestEntity WHERE ID > :VAL_1;
        TEST_3 = VAL_1;
      END`,

    `CREATE PROCEDURE "PROC_TEST_5" (
        IN A INTEGER,
        OUT B INTEGER,
        OUT C DUMMY,
        OUT D TABLE ( I NVARCHAR(1), J NVARCHAR(1) )
      ) AS BEGIN
        SELECT 'test' AS X FROM DUMMY;
        D = SELECT 'i' AS I, 'j' AS J FROM DUMMY;
        SELECT 2 AS Y FROM DUMMY;
        B = :A + 1;
        SELECT 3 AS Z FROM DUMMY;
        C = SELECT * FROM DUMMY;
      END`,

    `CREATE PROCEDURE PROC_TEST_6 ( OUT TABLE_1 TABLE ( COL_1 NVARCHAR(32) ), IN TABLE_2 TABLE ( COL_1 NVARCHAR(32) ), OUT TABLE_3 TABLE ( COL_1 NVARCHAR(32) ), INOUT VAL_1 NVARCHAR(32) ) AS
      BEGIN TABLE_1 = SELECT VAL_1 AS COL_1 FROM DUMMY; TABLE_3 = SELECT COL_1 AS COL_1 FROM :TABLE_2; END`,

    `CREATE PROCEDURE MY_PROC (
        IN PARAM_0 INT,
        OUT PARAM_1 TABLE ( NUM0 INT ),
        OUT PARAM_2 TABLE ( NUM1 INT )
      )
      LANGUAGE SQLSCRIPT
      DEFAULT SCHEMA ${schema}
      AS
      BEGIN
        PARAM_1=SELECT :PARAM_0 AS NUM0 FROM dummy;
        PARAM_2=SELECT :PARAM_0+1 AS NUM1 FROM dummy;
      END;`,

      `CREATE PROCEDURE MY_PROC_15 (
        IN PARAM_0 INT
      )
      LANGUAGE SQLSCRIPT
      DEFAULT SCHEMA ${schema}
      AS
      BEGIN
        INSERT INTO sap_capire_TestEntity (ID, title) VALUES (:PARAM_0, 'test');
      END;`
  ]

  for (let proc of procs) {
    try {
      await cds.run(proc)
    } catch (e) {
      if (e.code === 329) { // name exists
        // ignore
      } else {
        throw e
      }
    }
  }
}

async function addData() {
  const data = await cds.run(SELECT.from('SAP_CAPIRE_TESTENTITY'))
  if (data.length) return
  await cds.run(INSERT.into('SAP_CAPIRE_TESTENTITY').columns(['ID', 'title']).rows([1, '1']))
  await cds.run(INSERT.into('SAP_CAPIRE_TESTENTITY').columns(['ID', 'title']).rows([2, '2']))
  await cds.run(INSERT.into('SAP_CAPIRE_TESTENTITY').columns(['ID', 'title']).rows([3, '3']))
  await cds.run(INSERT.into('SAP_CAPIRE_TESTENTITY').columns(['ID', 'title']).rows([4, '4']))
}

describe('stored procedures', () => {
  const { expect } = cds.test(__dirname, 'proc.cds')

  beforeAll(async () => {
    await addData()
    await createProcedures()
  })

  describe('without schema name', () => {
    test('multiple parameters and table rows', async () => {
      const exp = {
        TEST_1: [
          { ID: 1, title: '1' },
          { ID: 2, title: '2' }
        ],
        TEST_2: [
          { ID: 3, title: '3' },
          { ID: 4, title: '4' }
        ],
        TEST_3: 2,
        VAL_1: 2
      }
      let res
      res = await cds.run(`CALL PROC_TEST_4(VAL_1 => ?,TEST_1 => ?,TEST_2 => ?,TEST_3 => ?)`, [2, 0])
      expect(res).to.containSubset(exp)
      res = await cds.run(`CALL PROC_TEST_4(TEST_1 => ?,TEST_2 => ?,TEST_3 => ?,VAL_1 => ?)`, [0, 2])
      expect(res).to.containSubset(exp)
      res = await cds.run(`CALL PROC_TEST_4(?,?,?,?)`, [0, 2])
      expect(res).to.containSubset(exp)
    })

    test('multiple output parameters 0', async () => {
      const exp = { TEST_1: [{ TEST_1_COL_1: '1' }], TEST_2: '2' }
      const res = await cds.run('CALL "procTest0"(?,?)')
      expect(res).to.containSubset(exp)
    })

    test('multiple output parameters 1', async () => {
      const exp = { TEST_1: [{ TEST_1_COL_1: '1' }], TEST_2: [{ TEST_2_COL_1: '2' }], VAL_1: '1' }
      let res
      res = await cds.run('CALL PROC_TEST_1(TEST_1 => ?,TEST_2 => ?,VAL_2 => ?,VAL_1 => ?)', ['2', '1'])
      expect(res).to.containSubset(exp)
      res = await cds.run('CALL PROC_TEST_1(TEST_1 => ?,TEST_2 => ?,VAL_1 => ?,VAL_2 => ?)', ['1', '2'])
      expect(res).to.containSubset(exp)
      res = await cds.run('CALL PROC_TEST_1(TEST_1 => ?,VAL_1 => ?,TEST_2 => ?,VAL_2 => ?)', ['1', '2'])
      expect(res).to.containSubset(exp)
      res = await cds.run('CALL PROC_TEST_1(?,?,?,?)', ['2', '1'])
      expect(res).to.containSubset(exp)
    })

    test('multiple output parameters 2', async () => {
      const exp = { TEST_1: [{ TEST_1_COL_1: '1' }], TEST_2: '2', VAL_1: '1' }
      let res
      // also testing leading whitespaces
      res = await cds.run(' CALL PROC_TEST_2(TEST_1 => ?,TEST_2 => ?,VAL_2 => ?,VAL_1 => ?)', ['2', '1'])
      expect(res).to.containSubset(exp)
      res = await cds.run(' CALL PROC_TEST_2(TEST_1 => ?,TEST_2 => ?,VAL_1 => ?,VAL_2 => ?)', ['1', '2'])
      expect(res).to.containSubset(exp)
      res = await cds.run(' CALL PROC_TEST_2(TEST_1 => ?,VAL_1 => ?,TEST_2 => ?,VAL_2 => ?)', ['1', '2'])
      expect(res).to.containSubset(exp)
      res = await cds.run(' CALL PROC_TEST_2(?,?,?,?)', ['2', '1'])
      expect(res).to.containSubset(exp)
    })

    test('multiple output parameters 3', async () => {
      const exp = { TEST_1: '1', TEST_2: '2', VAL_1: '1' }
      let res
      // also testing multiple whitespaces
      res = await cds.run('CALL   PROC_TEST_3(TEST_1 => ?,TEST_2 => ?,VAL_2 => ?,VAL_1 => ?)', ['2', '1'])
      expect(res).to.containSubset(exp)
      res = await cds.run('CALL   PROC_TEST_3(TEST_1 => ?,TEST_2 => ?,VAL_1 => ?,VAL_2 => ?)', ['1', '2'])
      expect(res).to.containSubset(exp)
      res = await cds.run('CALL   PROC_TEST_3(TEST_1 => ?,VAL_1 => ?,TEST_2 => ?,VAL_2 => ?)', ['1', '2'])
      expect(res).to.containSubset(exp)
      res = await cds.run('CALL   PROC_TEST_3(?,?,?,?)', ['2', '1'])
      expect(res).to.containSubset(exp)
    })

    test('arbitrary procedure name', async () => {
      const exp = { TEST_1: '2', TEST_2: '1', VAL_1: '2' }
      let res
      // name delimited with "" allows any character
      res = await cds.run('CALL   ";sap. secmon~analysis#framework!pattern@getNewAndExistingAlerts"  (? ,? ,?, ?) ', [
        '1',
        '2'
      ])
      expect(res).to.containSubset(exp)
    })

    test('tx isolation of procedures', async () => {
      try {
        await cds.tx(async (tx) => {
          await tx.run('CALL MY_PROC_15(?)', [1111])
          const res = await tx.run(SELECT.from('SAP_CAPIRE_TESTENTITY', { ID: 1111}).columns('ID'))
          expect(res).to.eql({ ID: 1111})
          throw new Error('test error') // initiate rollback
        })
      } catch(err) {
        expect(err.message).to.include('test error')
      }finally {
        const res = await cds.run(SELECT.from('SAP_CAPIRE_TESTENTITY', { ID: 1111}))
        expect(res).not.to.exist
      }
      
    })
  })

  describe('with schema name', () => {
    test('schema name — undelimited', async () => {
      const result = await cds.run(`CALL ${schema}.MY_PROC(PARAM_0 => ?, PARAM_1 => ?, PARAM_2 => ?);`, [0])
      expect(result).to.containSubset({
        PARAM_1: [{ NUM0: 0 }],
        PARAM_2: [{ NUM1: 1 }]
      })
    })

    test('schema name — delimited', async () => {
      const result = await cds.run(`CALL "${schema}"."MY_PROC"(PARAM_0 => ?, PARAM_1 => ?, PARAM_2 => ?);`, [0])
      expect(result).to.containSubset({
        PARAM_1: [{ NUM0: 0 }],
        PARAM_2: [{ NUM1: 1 }]
      })
    })
  })
})

