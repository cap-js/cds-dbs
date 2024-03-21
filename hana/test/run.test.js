const cds = require('../../test/cds')
const { expect } = require('@jest/globals')

describe('stored procedures', () => {
  cds.test(__dirname, 'proc.cds')
  
  async function createProcedures() {
    try {
      await cds.run(`
        CREATE PROCEDURE "procTest0" ( OUT TEST_1 TABLE ( TEST_1_COL_1 NVARCHAR(32) ), OUT TEST_2 NVARCHAR(32) ) AS
        BEGIN TEST_1 = SELECT '1' AS TEST_1_COL_1 FROM DUMMY; TEST_2 = '2'; END`)
    } catch (e) {
      if (e.message.match(/cannot use duplicate name of function or procedure/)) {
        // ignore
      } else {
        throw e
      }
    }
    try {
      await cds.run(`
        CREATE PROCEDURE PROC_TEST_1 ( OUT TEST_1 TABLE ( TEST_1_COL_1 NVARCHAR(32) ), IN VAL_2 NVARCHAR(32), OUT TEST_2 TABLE ( TEST_2_COL_1 NVARCHAR(32) ), INOUT VAL_1 NVARCHAR(32) ) AS
        BEGIN TEST_1 = SELECT VAL_1 AS TEST_1_COL_1 FROM DUMMY; TEST_2 = SELECT VAL_2 AS TEST_2_COL_1 FROM DUMMY; END`)
    } catch (e) {
      if (e.message.match(/cannot use duplicate name of function or procedure/)) {
        // ignore
      } else {
        throw e
      }
    }
    try {
      await cds.run(`
        CREATE PROCEDURE PROC_TEST_2 ( OUT TEST_1 TABLE ( TEST_1_COL_1 NVARCHAR(32) ), IN VAL_2 NVARCHAR(32), OUT TEST_2 NVARCHAR(32), INOUT VAL_1 NVARCHAR(32) ) AS
        BEGIN TEST_1 = SELECT VAL_1 AS TEST_1_COL_1 FROM DUMMY; TEST_2 = VAL_2; END`)
    } catch (e) {
      if (e.message.match(/cannot use duplicate name of function or procedure/)) {
        // ignore
      } else {
        throw e
      }
    }
    try {
      await cds.run(`
        CREATE PROCEDURE PROC_TEST_3 ( OUT TEST_1 NVARCHAR(32), IN VAL_2 NVARCHAR(32), OUT TEST_2 NVARCHAR(32), INOUT VAL_1 NVARCHAR(32) ) AS
        BEGIN TEST_1 = VAL_1; TEST_2 = VAL_2; END`)
    } catch (e) {
      if (e.message.match(/cannot use duplicate name of function or procedure/)) {
        // ignore
      } else {
        throw e
      }
    }
    try {
      await cds.run(`
        CREATE PROCEDURE ";sap. secmon~analysis#framework!pattern@getNewAndExistingAlerts" ( OUT TEST_1 NVARCHAR(32), IN VAL_2 NVARCHAR(32), OUT TEST_2 NVARCHAR(32), INOUT VAL_1 NVARCHAR(32) ) AS
        BEGIN TEST_1 = VAL_1; TEST_2 = VAL_2; END`)
    } catch (e) {
      if (e.message.match(/cannot use duplicate name of function or procedure/)) {
        // ignore
      } else {
        throw e
      }
    }
    try {      
      await cds.run(`
        CREATE PROCEDURE "PROC_TEST_4" (
          OUT TEST_1 TABLE ( ID INTEGER, "title" NVARCHAR(32) ),
          INOUT TEST_3 INTEGER,
          OUT TEST_2 TABLE ( ID INTEGER, "title" NVARCHAR(32) ),
          INOUT VAL_1 INTEGER
        ) AS BEGIN
          TEST_1 = SELECT ID, TITLE as "title" FROM sap_capire_TestEntity WHERE ID <= :VAL_1;
          TEST_2 = SELECT ID, TITLE as "title" FROM sap_capire_TestEntity WHERE ID > :VAL_1;
          TEST_3 = VAL_1;
        END
      `)
    } catch (e) {
      if (e.message.match(/cannot use duplicate name of function or procedure/)) {
        // ignore
      } else {
        throw e
      }
    }
    try {
      await cds.run(`
        CREATE PROCEDURE "PROC_TEST_5" (
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
        END
      `)
    } catch (e) {
      if (e.message.match(/cannot use duplicate name of function or procedure/)) {
        // ignore
      } else {
        throw e
      }
    }
    try {
      await cds.run(`
        CREATE PROCEDURE PROC_TEST_6 ( OUT TABLE_1 TABLE ( COL_1 NVARCHAR(32) ), IN TABLE_2 TABLE ( COL_1 NVARCHAR(32) ), OUT TABLE_3 TABLE ( COL_1 NVARCHAR(32) ), INOUT VAL_1 NVARCHAR(32) ) AS
        BEGIN TABLE_1 = SELECT VAL_1 AS COL_1 FROM DUMMY; TABLE_3 = SELECT COL_1 AS COL_1 FROM :TABLE_2; END`)
    } catch (e) {
      if (e.message.match(/cannot use duplicate name of function or procedure/)) {
        // ignore
      } else {
        throw e
      }
    }
  }

  async function addData() {
    try {   
      await cds.run(INSERT.into('SAP_CAPIRE_TESTENTITY').columns(['ID', 'title']).rows([1, '1']))
      await cds.run(INSERT.into('SAP_CAPIRE_TESTENTITY').columns(['ID', 'title']).rows([2, '2']))
      await cds.run(INSERT.into('SAP_CAPIRE_TESTENTITY').columns(['ID', 'title']).rows([3, '3']))
      await cds.run(INSERT.into('SAP_CAPIRE_TESTENTITY').columns(['ID', 'title']).rows([4, '4']))
    } catch (e) {
      // ignore
    }
  }

  beforeAll(async () => {    
    await addData()
    await createProcedures()  
  })

  describe('with dynatrace', () => {
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
      expect(res).toEqual(exp)
      res = await cds.run(`CALL PROC_TEST_4(TEST_1 => ?,TEST_2 => ?,TEST_3 => ?,VAL_1 => ?)`, [0, 2])
      expect(res).toEqual(exp)
      res = await cds.run(`CALL PROC_TEST_4(?,?,?,?)`, [0, 2])
      expect(res).toEqual(exp)
      // REVISIT order of OUT parameters does not match positions in stored procedure
      // > res = await cds.run(`CALL PROC_TEST_4(VAL_1 => ?,TEST_2 => ?,TEST_3 => ?,TEST_1 => ?)`, [2, 0])
      // > expect(res).toEqual(exp)
    })

    test('multiple output parameters 0', async () => {
      const exp = { TEST_1: [{ TEST_1_COL_1: '1' }], TEST_2: '2' }
      const res = await cds.run('CALL "procTest0"(?,?)')
      expect(res).toEqual(exp)
    })

    test('multiple output parameters 1', async () => {
      const exp = { TEST_1: [{ TEST_1_COL_1: '1' }], TEST_2: [{ TEST_2_COL_1: '2' }], VAL_1: '1' }
      let res
      res = await cds.run('CALL PROC_TEST_1(TEST_1 => ?,TEST_2 => ?,VAL_2 => ?,VAL_1 => ?)', ['2', '1'])
      expect(res).toEqual(exp)
      res = await cds.run('CALL PROC_TEST_1(TEST_1 => ?,TEST_2 => ?,VAL_1 => ?,VAL_2 => ?)', ['1', '2'])
      expect(res).toEqual(exp)
      res = await cds.run('CALL PROC_TEST_1(TEST_1 => ?,VAL_1 => ?,TEST_2 => ?,VAL_2 => ?)', ['1', '2'])
      expect(res).toEqual(exp)
      res = await cds.run('CALL PROC_TEST_1(?,?,?,?)', ['2', '1'])
      expect(res).toEqual(exp)
    })

    test('multiple output parameters 2', async () => {
      const exp = { TEST_1: [{ TEST_1_COL_1: '1' }], TEST_2: '2', VAL_1: '1' }
      let res
      // also testing leading whitespaces
      res = await cds.run(' CALL PROC_TEST_2(TEST_1 => ?,TEST_2 => ?,VAL_2 => ?,VAL_1 => ?)', ['2', '1'])
      expect(res).toEqual(exp)
      res = await cds.run(' CALL PROC_TEST_2(TEST_1 => ?,TEST_2 => ?,VAL_1 => ?,VAL_2 => ?)', ['1', '2'])
      expect(res).toEqual(exp)
      res = await cds.run(' CALL PROC_TEST_2(TEST_1 => ?,VAL_1 => ?,TEST_2 => ?,VAL_2 => ?)', ['1', '2'])
      expect(res).toEqual(exp)
      res = await cds.run(' CALL PROC_TEST_2(?,?,?,?)', ['2', '1'])
      expect(res).toEqual(exp)
    })

    test('multiple output parameters 3', async () => {
      const exp = { TEST_1: '1', TEST_2: '2', VAL_1: '1' }
      let res
      // also testing multiple whitespaces
      res = await cds.run('CALL   PROC_TEST_3(TEST_1 => ?,TEST_2 => ?,VAL_2 => ?,VAL_1 => ?)', ['2', '1'])
      expect(res).toEqual(exp)
      res = await cds.run('CALL   PROC_TEST_3(TEST_1 => ?,TEST_2 => ?,VAL_1 => ?,VAL_2 => ?)', ['1', '2'])
      expect(res).toEqual(exp)
      res = await cds.run('CALL   PROC_TEST_3(TEST_1 => ?,VAL_1 => ?,TEST_2 => ?,VAL_2 => ?)', ['1', '2'])
      expect(res).toEqual(exp)
      res = await cds.run('CALL   PROC_TEST_3(?,?,?,?)', ['2', '1'])
      expect(res).toEqual(exp)
    })

    test('arbitrary procedure name', async () => {
      const exp = { TEST_1: '2', TEST_2: '1', VAL_1: '2' }
      let res
      // name delimited with "" allows any character
      res = await cds.run('CALL   ";sap. secmon~analysis#framework!pattern@getNewAndExistingAlerts"  (? ,? ,?, ?) ', [
        '1',
        '2'
      ])
      expect(res).toEqual(exp)
    })
  })

  describe('without dynatrace', () => {
    beforeAll(() => {
      process.env.CDS_SKIP_DYNATRACE = 'true'
    })

    afterAll(() => {
      delete process.env.CDS_SKIP_DYNATRACE
    })

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
      expect(res).toEqual(exp)
      res = await cds.run(`CALL PROC_TEST_4(TEST_1 => ?,TEST_2 => ?,TEST_3 => ?,VAL_1 => ?)`, [0, 2])
      expect(res).toEqual(exp)
      res = await cds.run(`CALL PROC_TEST_4(?,?,?,?)`, [0, 2])
      expect(res).toEqual(exp)
      // REVISIT order of OUT parameters does not match positions in stored procedure
      // > res = await cds.run(`CALL PROC_TEST_4(VAL_1 => ?,TEST_2 => ?,TEST_3 => ?,TEST_1 => ?)`, [2, 0])
      // > expect(res).toEqual(exp)
    })

    test('multiple output parameters 0', async () => {
      const exp = { TEST_1: [{ TEST_1_COL_1: '1' }], TEST_2: '2' }
      const res = await cds.run('CALL "procTest0"(?,?)')
      expect(res).toEqual(exp)
    })

    test('multiple output parameters 1', async () => {
      const exp = { TEST_1: [{ TEST_1_COL_1: '1' }], TEST_2: [{ TEST_2_COL_1: '2' }], VAL_1: '1' }
      let res
      res = await cds.run('CALL PROC_TEST_1(TEST_1 => ?,TEST_2 => ?,VAL_2 => ?,VAL_1 => ?)', ['2', '1'])
      expect(res).toEqual(exp)
      res = await cds.run('CALL PROC_TEST_1(TEST_1 => ?,TEST_2 => ?,VAL_1 => ?,VAL_2 => ?)', ['1', '2'])
      expect(res).toEqual(exp)
      res = await cds.run('CALL PROC_TEST_1(TEST_1 => ?,VAL_1 => ?,TEST_2 => ?,VAL_2 => ?)', ['1', '2'])
      expect(res).toEqual(exp)
      res = await cds.run('CALL PROC_TEST_1(?,?,?,?)', ['2', '1'])
      expect(res).toEqual(exp)
    })

    test('multiple output parameters 2', async () => {
      const exp = { TEST_1: [{ TEST_1_COL_1: '1' }], TEST_2: '2', VAL_1: '1' }
      let res
      // also testing leading whitespaces
      res = await cds.run(' CALL PROC_TEST_2(TEST_1 => ?,TEST_2 => ?,VAL_2 => ?,VAL_1 => ?)', ['2', '1'])
      expect(res).toEqual(exp)
      res = await cds.run(' CALL PROC_TEST_2(TEST_1 => ?,TEST_2 => ?,VAL_1 => ?,VAL_2 => ?)', ['1', '2'])
      expect(res).toEqual(exp)
      res = await cds.run(' CALL PROC_TEST_2(TEST_1 => ?,VAL_1 => ?,TEST_2 => ?,VAL_2 => ?)', ['1', '2'])
      expect(res).toEqual(exp)
      res = await cds.run(' CALL PROC_TEST_2(?,?,?,?)', ['2', '1'])
      expect(res).toEqual(exp)
    })

    test('multiple output parameters 3', async () => {
      const exp = { TEST_1: '1', TEST_2: '2', VAL_1: '1' }
      let res
      // also testing multiple whitespaces
      res = await cds.run('CALL   PROC_TEST_3(TEST_1 => ?,TEST_2 => ?,VAL_2 => ?,VAL_1 => ?)', ['2', '1'])
      expect(res).toEqual(exp)
      res = await cds.run('CALL   PROC_TEST_3(TEST_1 => ?,TEST_2 => ?,VAL_1 => ?,VAL_2 => ?)', ['1', '2'])
      expect(res).toEqual(exp)
      res = await cds.run('CALL   PROC_TEST_3(TEST_1 => ?,VAL_1 => ?,TEST_2 => ?,VAL_2 => ?)', ['1', '2'])
      expect(res).toEqual(exp)
      res = await cds.run('CALL   PROC_TEST_3(?,?,?,?)', ['2', '1'])
      expect(res).toEqual(exp)
    })

    test('arbitrary procedure name', async () => {
      const exp = { TEST_1: '2', TEST_2: '1', VAL_1: '2' }
      let res
      // name delimited with "" allows any character
      res = await cds.run('CALL   ";sap. secmon~analysis#framework!pattern@getNewAndExistingAlerts"  (? ,? ,?, ?) ', [
        '1',
        '2'
      ])
      expect(res).toEqual(exp)
    })

    test('procedure containing implicit selects', async () => {
      // implicit select results are ignored and don't show up in output
      const exp = { B: 5, C: [{ DUMMY: 'X' }], D: [{ I: 'i', J: 'j' }] }
      let res
      res = await cds.run('CALL PROC_TEST_5(? ,? ,?, ?)', { A: 4 })
      expect(res).toEqual(exp)
    })

    test('with table as input parameter', async () => {
      const exp = { TABLE_1: [{ COL_1: 'val_1' }], TABLE_3: [{ COL_1: 'ltt_1' }, { COL_1: 'ltt_2' }], VAL_1: 'val_1' }
      const ltt = `#ltt_${cds.utils.uuid().replace(/-/g, '_')}` //> random name
      await cds.run(`create local temporary table ${ltt} (COL_1 NVARCHAR(32))`)
      await cds.run(`insert into ${ltt} values (?)`, [['ltt_1'], ['ltt_2']])
      const res = await cds.run(`CALL PROC_TEST_6(TABLE_1 => ?, TABLE_2 => ${ltt}, TABLE_3 => ?, VAL_1 => ?)`, [
        'val_1'
      ])
      expect(res).toEqual(exp)
    })
  })
})

