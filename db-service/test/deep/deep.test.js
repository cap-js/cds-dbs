const cds = require('../../../test/cds')
cds.test.in(__dirname) // IMPORTANT: that has to go before loading cds.env below
cds.env.features.recursion_depth = 2

const { getDeepQueries, getExpandForDeep } = require('../../lib/deep-queries')

describe('test deep query generation', () => {

  cds.test()
  let model; beforeAll(() => model = cds.model)

  describe('deep expand', () => {
    // SKIPPED because that test is testing obsolete internal implementation of deep delete
    test.skip('Deep DELETE with to-one all data provided', () => {
      const query = getExpandForDeep(DELETE.from(model.definitions.Root).where({ ID: 1 }), model.definitions.Root)
      expect(query).toEqual({
        SELECT: {
          from: { ref: ['Root'] },
          where: [
            {
              ref: ['ID'],
            },
            '=',
            {
              val: 1,
            },
          ],
          columns: [
            { ref: ['ID'] },
            {
              ref: ['toOneChild'],
              expand: [
                { ref: ['ID'] },
                { ref: ['toOneSubChild'], expand: [{ ref: ['ID'] }] },
                { ref: ['toManySubChild'], expand: [{ ref: ['ID'] }] },
                {
                  ref: ['toOneChild'],
                  expand: [
                    { ref: ['ID'] },
                    { ref: ['toOneSubChild'], expand: [{ ref: ['ID'] }] },
                    { ref: ['toManySubChild'], expand: [{ ref: ['ID'] }] },
                    {
                      ref: ['toOneChild'],
                      expand: [
                        { ref: ['ID'] },
                        { ref: ['toOneSubChild'], expand: [{ ref: ['ID'] }] },
                        { ref: ['toManySubChild'], expand: [{ ref: ['ID'] }] },
                      ],
                    },
                    {
                      ref: ['toManyChild'],
                      expand: [
                        { ref: ['ID'] },
                        { ref: ['toOneSubChild'], expand: [{ ref: ['ID'] }] },
                        { ref: ['toManySubChild'], expand: [{ ref: ['ID'] }] },
                        {
                          ref: ['toOneChild'],
                          expand: [
                            { ref: ['ID'] },
                            { ref: ['toOneSubChild'], expand: [{ ref: ['ID'] }] },
                            { ref: ['toManySubChild'], expand: [{ ref: ['ID'] }] },
                          ],
                        },
                        {
                          ref: ['toManyChild'],
                          expand: [
                            { ref: ['ID'] },
                            { ref: ['toOneSubChild'], expand: [{ ref: ['ID'] }] },
                            { ref: ['toManySubChild'], expand: [{ ref: ['ID'] }] },
                            {
                              ref: ['toOneChild'],
                              expand: [
                                { ref: ['ID'] },
                                { ref: ['toOneSubChild'], expand: [{ ref: ['ID'] }] },
                                { ref: ['toManySubChild'], expand: [{ ref: ['ID'] }] },
                              ],
                            },
                          ],
                        },
                      ],
                    },
                  ],
                },
                {
                  ref: ['toManyChild'],
                  expand: [
                    { ref: ['ID'] },
                    { ref: ['toOneSubChild'], expand: [{ ref: ['ID'] }] },
                    { ref: ['toManySubChild'], expand: [{ ref: ['ID'] }] },
                    {
                      ref: ['toOneChild'],
                      expand: [
                        { ref: ['ID'] },
                        { ref: ['toOneSubChild'], expand: [{ ref: ['ID'] }] },
                        { ref: ['toManySubChild'], expand: [{ ref: ['ID'] }] },
                        {
                          ref: ['toOneChild'],
                          expand: [
                            { ref: ['ID'] },
                            { ref: ['toOneSubChild'], expand: [{ ref: ['ID'] }] },
                            { ref: ['toManySubChild'], expand: [{ ref: ['ID'] }] },
                          ],
                        },
                        {
                          ref: ['toManyChild'],
                          expand: [
                            { ref: ['ID'] },
                            { ref: ['toOneSubChild'], expand: [{ ref: ['ID'] }] },
                            { ref: ['toManySubChild'], expand: [{ ref: ['ID'] }] },
                            {
                              ref: ['toOneChild'],
                              expand: [
                                { ref: ['ID'] },
                                { ref: ['toOneSubChild'], expand: [{ ref: ['ID'] }] },
                                { ref: ['toManySubChild'], expand: [{ ref: ['ID'] }] },
                              ],
                            },
                          ],
                        },
                      ],
                    },
                    {
                      ref: ['toManyChild'],
                      expand: [
                        { ref: ['ID'] },
                        { ref: ['toOneSubChild'], expand: [{ ref: ['ID'] }] },
                        { ref: ['toManySubChild'], expand: [{ ref: ['ID'] }] },
                        {
                          ref: ['toOneChild'],
                          expand: [
                            { ref: ['ID'] },
                            { ref: ['toOneSubChild'], expand: [{ ref: ['ID'] }] },
                            { ref: ['toManySubChild'], expand: [{ ref: ['ID'] }] },
                            {
                              ref: ['toOneChild'],
                              expand: [
                                { ref: ['ID'] },
                                { ref: ['toOneSubChild'], expand: [{ ref: ['ID'] }] },
                                { ref: ['toManySubChild'], expand: [{ ref: ['ID'] }] },
                              ],
                            },
                          ],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
            {
              ref: ['toManyChild'],
              expand: [
                { ref: ['ID'] },
                { ref: ['toOneSubChild'], expand: [{ ref: ['ID'] }] },
                { ref: ['toManySubChild'], expand: [{ ref: ['ID'] }] },
                {
                  ref: ['toOneChild'],
                  expand: [
                    { ref: ['ID'] },
                    { ref: ['toOneSubChild'], expand: [{ ref: ['ID'] }] },
                    { ref: ['toManySubChild'], expand: [{ ref: ['ID'] }] },
                    {
                      ref: ['toOneChild'],
                      expand: [
                        { ref: ['ID'] },
                        { ref: ['toOneSubChild'], expand: [{ ref: ['ID'] }] },
                        { ref: ['toManySubChild'], expand: [{ ref: ['ID'] }] },
                      ],
                    },
                    {
                      ref: ['toManyChild'],
                      expand: [
                        { ref: ['ID'] },
                        { ref: ['toOneSubChild'], expand: [{ ref: ['ID'] }] },
                        { ref: ['toManySubChild'], expand: [{ ref: ['ID'] }] },
                        {
                          ref: ['toOneChild'],
                          expand: [
                            { ref: ['ID'] },
                            { ref: ['toOneSubChild'], expand: [{ ref: ['ID'] }] },
                            { ref: ['toManySubChild'], expand: [{ ref: ['ID'] }] },
                          ],
                        },
                        {
                          ref: ['toManyChild'],
                          expand: [
                            { ref: ['ID'] },
                            { ref: ['toOneSubChild'], expand: [{ ref: ['ID'] }] },
                            { ref: ['toManySubChild'], expand: [{ ref: ['ID'] }] },
                            {
                              ref: ['toOneChild'],
                              expand: [
                                { ref: ['ID'] },
                                { ref: ['toOneSubChild'], expand: [{ ref: ['ID'] }] },
                                { ref: ['toManySubChild'], expand: [{ ref: ['ID'] }] },
                              ],
                            },
                          ],
                        },
                      ],
                    },
                  ],
                },
                {
                  ref: ['toManyChild'],
                  expand: [
                    { ref: ['ID'] },
                    { ref: ['toOneSubChild'], expand: [{ ref: ['ID'] }] },
                    { ref: ['toManySubChild'], expand: [{ ref: ['ID'] }] },
                    {
                      ref: ['toOneChild'],
                      expand: [
                        { ref: ['ID'] },
                        { ref: ['toOneSubChild'], expand: [{ ref: ['ID'] }] },
                        { ref: ['toManySubChild'], expand: [{ ref: ['ID'] }] },
                        {
                          ref: ['toOneChild'],
                          expand: [
                            { ref: ['ID'] },
                            { ref: ['toOneSubChild'], expand: [{ ref: ['ID'] }] },
                            { ref: ['toManySubChild'], expand: [{ ref: ['ID'] }] },
                          ],
                        },
                        {
                          ref: ['toManyChild'],
                          expand: [
                            { ref: ['ID'] },
                            { ref: ['toOneSubChild'], expand: [{ ref: ['ID'] }] },
                            { ref: ['toManySubChild'], expand: [{ ref: ['ID'] }] },
                            {
                              ref: ['toOneChild'],
                              expand: [
                                { ref: ['ID'] },
                                { ref: ['toOneSubChild'], expand: [{ ref: ['ID'] }] },
                                { ref: ['toManySubChild'], expand: [{ ref: ['ID'] }] },
                              ],
                            },
                          ],
                        },
                      ],
                    },
                    {
                      ref: ['toManyChild'],
                      expand: [
                        { ref: ['ID'] },
                        { ref: ['toOneSubChild'], expand: [{ ref: ['ID'] }] },
                        { ref: ['toManySubChild'], expand: [{ ref: ['ID'] }] },
                        {
                          ref: ['toOneChild'],
                          expand: [
                            { ref: ['ID'] },
                            { ref: ['toOneSubChild'], expand: [{ ref: ['ID'] }] },
                            { ref: ['toManySubChild'], expand: [{ ref: ['ID'] }] },
                            {
                              ref: ['toOneChild'],
                              expand: [
                                { ref: ['ID'] },
                                { ref: ['toOneSubChild'], expand: [{ ref: ['ID'] }] },
                                { ref: ['toManySubChild'], expand: [{ ref: ['ID'] }] },
                              ],
                            },
                          ],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      })
    })
    test('Deep UPDATE with to-one all data provided', () => {
      const query = getExpandForDeep(
        UPDATE.entity(model.definitions.Root).with({
          ID: 1,
          toOneChild: { ID: 10, toOneSubChild: { ID: 30 } },
        }),
        model.definitions.Root,
      )
      expect(query).toEqual({
        SELECT: {
          from: { ref: ['Root'] },
          columns: [
            { ref: ['ID'] },
            { ref: ['toOneChild'], expand: [{ ref: ['ID'] }, { ref: ['toOneSubChild'], expand: [{ ref: ['ID'] }] }] },
          ],
        },
      })
    })

    test('Deep UPDATE with to-many delete children', () => {
      const query = getExpandForDeep(
        UPDATE.entity(model.definitions.Root).with({
          ID: 1,
          toManyChild: [
            { ID: 10, toManySubChild: [{ ID: 20, subText: 'sub' }] },
            { ID: 21, text: 'text' },
          ],
        }),
        model.definitions.Root,
      )
      expect(query).toEqual({
        SELECT: {
          from: { ref: ['Root'] },
          columns: [
            { ref: ['ID'] },
            {
              ref: ['toManyChild'],
              expand: [
                { ref: ['ID'] },
                { ref: ['text'] },
                { ref: ['toManySubChild'], expand: [{ ref: ['ID'] }, { ref: ['subText'] }] },
              ],
            },
          ],
        },
      })
    })

    test('Deep UPDATE with to-one delete children', () => {
      const query = getExpandForDeep(
        UPDATE.entity(model.definitions.Root).with({
          ID: 1,
          toOneChild: null,
        }),
        model.definitions.Root,
      )
      expect(query).toEqual({
        SELECT: {
          from: { ref: ['Root'] },
          columns: [
            { ref: ['ID'] },
            {
              ref: ['toOneChild'],
              expand: [
                { ref: ['ID'] },
                { ref: ['toOneSubChild'], expand: [{ ref: ['ID'] }] },
                { ref: ['toManySubChild'], expand: [{ ref: ['ID'] }] },
                {
                  ref: ['toOneChild'],
                  expand: [
                    { ref: ['ID'] },
                    { ref: ['toOneSubChild'], expand: [{ ref: ['ID'] }] },
                    { ref: ['toManySubChild'], expand: [{ ref: ['ID'] }] },
                    {
                      ref: ['toOneChild'],
                      expand: [
                        { ref: ['ID'] },
                        { ref: ['toOneSubChild'], expand: [{ ref: ['ID'] }] },
                        { ref: ['toManySubChild'], expand: [{ ref: ['ID'] }] },
                      ],
                    },
                    {
                      ref: ['toManyChild'],
                      expand: [
                        { ref: ['ID'] },
                        { ref: ['toOneSubChild'], expand: [{ ref: ['ID'] }] },
                        { ref: ['toManySubChild'], expand: [{ ref: ['ID'] }] },
                        {
                          ref: ['toOneChild'],
                          expand: [
                            { ref: ['ID'] },
                            { ref: ['toOneSubChild'], expand: [{ ref: ['ID'] }] },
                            { ref: ['toManySubChild'], expand: [{ ref: ['ID'] }] },
                          ],
                        },
                        {
                          ref: ['toManyChild'],
                          expand: [
                            { ref: ['ID'] },
                            { ref: ['toOneSubChild'], expand: [{ ref: ['ID'] }] },
                            { ref: ['toManySubChild'], expand: [{ ref: ['ID'] }] },
                            {
                              ref: ['toOneChild'],
                              expand: [
                                { ref: ['ID'] },
                                { ref: ['toOneSubChild'], expand: [{ ref: ['ID'] }] },
                                { ref: ['toManySubChild'], expand: [{ ref: ['ID'] }] },
                              ],
                            },
                          ],
                        },
                      ],
                    },
                  ],
                },
                {
                  ref: ['toManyChild'],
                  expand: [
                    { ref: ['ID'] },
                    { ref: ['toOneSubChild'], expand: [{ ref: ['ID'] }] },
                    { ref: ['toManySubChild'], expand: [{ ref: ['ID'] }] },
                    {
                      ref: ['toOneChild'],
                      expand: [
                        { ref: ['ID'] },
                        { ref: ['toOneSubChild'], expand: [{ ref: ['ID'] }] },
                        { ref: ['toManySubChild'], expand: [{ ref: ['ID'] }] },
                        {
                          ref: ['toOneChild'],
                          expand: [
                            { ref: ['ID'] },
                            { ref: ['toOneSubChild'], expand: [{ ref: ['ID'] }] },
                            { ref: ['toManySubChild'], expand: [{ ref: ['ID'] }] },
                          ],
                        },
                        {
                          ref: ['toManyChild'],
                          expand: [
                            { ref: ['ID'] },
                            { ref: ['toOneSubChild'], expand: [{ ref: ['ID'] }] },
                            { ref: ['toManySubChild'], expand: [{ ref: ['ID'] }] },
                            {
                              ref: ['toOneChild'],
                              expand: [
                                { ref: ['ID'] },
                                { ref: ['toOneSubChild'], expand: [{ ref: ['ID'] }] },
                                { ref: ['toManySubChild'], expand: [{ ref: ['ID'] }] },
                              ],
                            },
                          ],
                        },
                      ],
                    },
                    {
                      ref: ['toManyChild'],
                      expand: [
                        { ref: ['ID'] },
                        { ref: ['toOneSubChild'], expand: [{ ref: ['ID'] }] },
                        { ref: ['toManySubChild'], expand: [{ ref: ['ID'] }] },
                        {
                          ref: ['toOneChild'],
                          expand: [
                            { ref: ['ID'] },
                            { ref: ['toOneSubChild'], expand: [{ ref: ['ID'] }] },
                            { ref: ['toManySubChild'], expand: [{ ref: ['ID'] }] },
                            {
                              ref: ['toOneChild'],
                              expand: [
                                { ref: ['ID'] },
                                { ref: ['toOneSubChild'], expand: [{ ref: ['ID'] }] },
                                { ref: ['toManySubChild'], expand: [{ ref: ['ID'] }] },
                              ],
                            },
                          ],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      })
    })

    test('UPDATE builds expand based on data', () => {
      const query = getExpandForDeep(
        UPDATE.entity(model.definitions.Root).with({
          ID: 1,
          toOneChild: { ID: 10 },
          toManyChild: [
            { ID: 11, toOneSubChild: { ID: 20 }, toManySubChild: null, text: 'foo' },
            {
              ID: 12,
              toManyChild: [
                { ID: 13, toManyChild: null },
                { ID: 14, toManySubChild: [{ ID: 21 }] },
              ],
            },
          ],
        }),
        model.definitions.Root,
      )
      // TODO toManySubChild: null -> max recursion
      expect(query).toEqual({
        SELECT: {
          from: { ref: ['Root'] },
          columns: [
            { ref: ['ID'] },
            { ref: ['toOneChild'], expand: [{ ref: ['ID'] }] },
            {
              ref: ['toManyChild'],
              expand: [
                { ref: ['ID'] },
                { ref: ['text'] },
                { ref: ['toOneSubChild'], expand: [{ ref: ['ID'] }] },
                { ref: ['toManySubChild'], expand: [{ ref: ['ID'] }] },
                {
                  ref: ['toManyChild'],
                  expand: [
                    { ref: ['ID'] },
                    {
                      ref: ['toManyChild'],
                      expand: [
                        { ref: ['ID'] },
                        { ref: ['toOneSubChild'], expand: [{ ref: ['ID'] }] },
                        { ref: ['toManySubChild'], expand: [{ ref: ['ID'] }] },
                        {
                          ref: ['toOneChild'],
                          expand: [
                            { ref: ['ID'] },
                            { ref: ['toOneSubChild'], expand: [{ ref: ['ID'] }] },
                            { ref: ['toManySubChild'], expand: [{ ref: ['ID'] }] },
                            {
                              ref: ['toOneChild'],
                              expand: [
                                { ref: ['ID'] },
                                { ref: ['toOneSubChild'], expand: [{ ref: ['ID'] }] },
                                { ref: ['toManySubChild'], expand: [{ ref: ['ID'] }] },
                              ],
                            },
                          ],
                        },
                      ],
                    },
                    { ref: ['toManySubChild'], expand: [{ ref: ['ID'] }] },
                  ],
                },
              ],
            },
          ],
        },
      })
    })

    test('UPDATE works when removing all children', () => {
      const query = getExpandForDeep(
        UPDATE.entity(model.definitions.Root).with({
          ID: 1,
          toOneChild: { ID: 10 },
          toManyChild: [],
        }),
        model.definitions.Root,
      )

      // expectation also needs to be adapted
      expect(query).toMatchObject({
        SELECT: {
          from: { ref: ['Root'] },
          columns: [
            { ref: ['ID'] },
            { ref: ['toOneChild'], expand: [{ ref: ['ID'] }] },
            {
              ref: ['toManyChild'],
              expand: [
                { ref: ['ID'] },
                { ref: ['toOneSubChild'], expand: [{ ref: ['ID'] }] },
                { ref: ['toManySubChild'], expand: [{ ref: ['ID'] }] },
                {
                  ref: ['toOneChild'],
                  expand: [
                    { ref: ['ID'] },
                    { ref: ['toOneSubChild'], expand: [{ ref: ['ID'] }] },
                    { ref: ['toManySubChild'], expand: [{ ref: ['ID'] }] },
                    {
                      ref: ['toOneChild'],
                      expand: [
                        { ref: ['ID'] },
                        { ref: ['toOneSubChild'], expand: [{ ref: ['ID'] }] },
                        { ref: ['toManySubChild'], expand: [{ ref: ['ID'] }] },
                      ],
                    },
                    {
                      ref: ['toManyChild'],
                      expand: [
                        { ref: ['ID'] },
                        { ref: ['toOneSubChild'], expand: [{ ref: ['ID'] }] },
                        { ref: ['toManySubChild'], expand: [{ ref: ['ID'] }] },
                        {
                          ref: ['toOneChild'],
                          expand: [
                            { ref: ['ID'] },
                            { ref: ['toOneSubChild'], expand: [{ ref: ['ID'] }] },
                            { ref: ['toManySubChild'], expand: [{ ref: ['ID'] }] },
                          ],
                        },
                        {
                          ref: ['toManyChild'],
                          expand: [
                            { ref: ['ID'] },
                            { ref: ['toOneSubChild'], expand: [{ ref: ['ID'] }] },
                            { ref: ['toManySubChild'], expand: [{ ref: ['ID'] }] },
                            {
                              ref: ['toOneChild'],
                              expand: [
                                { ref: ['ID'] },
                                { ref: ['toOneSubChild'], expand: [{ ref: ['ID'] }] },
                                { ref: ['toManySubChild'], expand: [{ ref: ['ID'] }] },
                              ],
                            },
                          ],
                        },
                      ],
                    },
                  ],
                },
                {
                  ref: ['toManyChild'],
                  expand: [
                    { ref: ['ID'] },
                    { ref: ['toOneSubChild'], expand: [{ ref: ['ID'] }] },
                    { ref: ['toManySubChild'], expand: [{ ref: ['ID'] }] },
                    {
                      ref: ['toOneChild'],
                      expand: [
                        { ref: ['ID'] },
                        { ref: ['toOneSubChild'], expand: [{ ref: ['ID'] }] },
                        { ref: ['toManySubChild'], expand: [{ ref: ['ID'] }] },
                        {
                          ref: ['toOneChild'],
                          expand: [
                            { ref: ['ID'] },
                            { ref: ['toOneSubChild'], expand: [{ ref: ['ID'] }] },
                            { ref: ['toManySubChild'], expand: [{ ref: ['ID'] }] },
                          ],
                        },
                        {
                          ref: ['toManyChild'],
                          expand: [
                            { ref: ['ID'] },
                            { ref: ['toOneSubChild'], expand: [{ ref: ['ID'] }] },
                            { ref: ['toManySubChild'], expand: [{ ref: ['ID'] }] },
                            {
                              ref: ['toOneChild'],
                              expand: [
                                { ref: ['ID'] },
                                { ref: ['toOneSubChild'], expand: [{ ref: ['ID'] }] },
                                { ref: ['toManySubChild'], expand: [{ ref: ['ID'] }] },
                              ],
                            },
                          ],
                        },
                      ],
                    },
                    {
                      ref: ['toManyChild'],
                      expand: [
                        { ref: ['ID'] },
                        { ref: ['toOneSubChild'], expand: [{ ref: ['ID'] }] },
                        { ref: ['toManySubChild'], expand: [{ ref: ['ID'] }] },
                        {
                          ref: ['toOneChild'],
                          expand: [
                            { ref: ['ID'] },
                            { ref: ['toOneSubChild'], expand: [{ ref: ['ID'] }] },
                            { ref: ['toManySubChild'], expand: [{ ref: ['ID'] }] },
                            {
                              ref: ['toOneChild'],
                              expand: [
                                { ref: ['ID'] },
                                { ref: ['toOneSubChild'], expand: [{ ref: ['ID'] }] },
                                { ref: ['toManySubChild'], expand: [{ ref: ['ID'] }] },
                              ],
                            },
                          ],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      })
    })

    test.skip('works with recursive and stops after getting to the same level 2 times', () => {
      const query = getExpandForDeep(
        DELETE.from(model.definitions.Recursive).where({ ID: 5 }),
        model.definitions.Recursive,
      )
      expect(query).toEqual({
        SELECT: {
          from: { ref: ['Recursive'] },
          where: [
            {
              ref: ['ID'],
            },
            '=',
            {
              val: 5,
            },
          ],
          columns: [
            { ref: ['ID'] },
            {
              ref: ['toOneRecursive'],
              expand: [
                { ref: ['ID'] },
                { ref: ['toOneRecursive'], expand: [{ ref: ['ID'] }] },
                {
                  ref: ['toOneTransient'],
                  expand: [
                    { ref: ['ID'] },
                    {
                      ref: ['toOneRecursive'],
                      expand: [
                        { ref: ['ID'] },
                        { ref: ['toOneRecursive'], expand: [{ ref: ['ID'] }] },
                        {
                          ref: ['toOneTransient'],
                          expand: [
                            { ref: ['ID'] },
                            {
                              ref: ['toOneRecursive'],
                              expand: [{ ref: ['ID'] }, { ref: ['toOneRecursive'], expand: [{ ref: ['ID'] }] }],
                            },
                          ],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
            {
              ref: ['toOneTransient'],
              expand: [
                { ref: ['ID'] },
                {
                  ref: ['toOneRecursive'],
                  expand: [
                    { ref: ['ID'] },
                    {
                      ref: ['toOneRecursive'],
                      expand: [
                        { ref: ['ID'] },
                        { ref: ['toOneRecursive'], expand: [{ ref: ['ID'] }] },
                        {
                          ref: ['toOneTransient'],
                          expand: [
                            { ref: ['ID'] },
                            {
                              ref: ['toOneRecursive'],
                              expand: [{ ref: ['ID'] }, { ref: ['toOneRecursive'], expand: [{ ref: ['ID'] }] }],
                            },
                          ],
                        },
                      ],
                    },
                    {
                      ref: ['toOneTransient'],
                      expand: [
                        { ref: ['ID'] },
                        {
                          ref: ['toOneRecursive'],
                          expand: [
                            { ref: ['ID'] },
                            {
                              ref: ['toOneRecursive'],
                              expand: [{ ref: ['ID'] }, { ref: ['toOneRecursive'], expand: [{ ref: ['ID'] }] }],
                            },
                          ],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      })
    })
  })

  describe('INSERT', () => {
    test('creates sub inserts', () => {
      const query = INSERT.into(model.definitions.Root).entries([
        { ID: 1, toOneChild: { ID: 1 } },
        { ID: 2, toOneChild: { ID: 2, toManySubChild: [{ ID: 10 }] } },
        {
          ID: 3,
          toManyChild: [
            { ID: 3, toManySubChild: [{ ID: 11 }, { ID: 12 }] },
            { ID: 4, toManySubChild: [{ ID: 13 }] },
            { ID: 5, toManyChild: [{ ID: 6 }, { ID: 7 }] },
            { ID: 8, toOneChild: { ID: 9 } },
          ],
        },
      ])
      const deepQueries = getDeepQueries(query, [], model.definitions.Root)

      const expectedInserts = [
        INSERT.into(model.definitions.Root).entries({ ID: 1 }),
        INSERT.into(model.definitions.Root).entries({ ID: 2 }),
        INSERT.into(model.definitions.Root).entries({ ID: 3 }),
        INSERT.into(model.definitions.Child).entries({ ID: 1 }),
        INSERT.into(model.definitions.Child).entries({ ID: 2 }),
        INSERT.into(model.definitions.Child).entries({ ID: 3 }),
        INSERT.into(model.definitions.Child).entries({ ID: 4 }),
        INSERT.into(model.definitions.Child).entries({ ID: 5 }),
        INSERT.into(model.definitions.Child).entries({ ID: 6 }),
        INSERT.into(model.definitions.Child).entries({ ID: 7 }),
        INSERT.into(model.definitions.Child).entries({ ID: 8 }),
        INSERT.into(model.definitions.Child).entries({ ID: 9 }),
        INSERT.into(model.definitions.SubChild).entries({ ID: 10 }),
        INSERT.into(model.definitions.SubChild).entries({ ID: 11 }),
        INSERT.into(model.definitions.SubChild).entries({ ID: 12 }),
        INSERT.into(model.definitions.SubChild).entries({ ID: 13 }),
      ]

      expectedInserts.forEach(insert => {
        expect(deepQueries).toContainEqual(insert)
      })
    })

    test('backlink keys are properly propagated', async () => {
      const entity = model.definitions['keyAssocs.Header']

      const entry = {
        uniqueName: 'PR1',
        realm: 'dummy',
        l1s: [
          {
            number: 1,
            l2s: [
              {
                percentage: 50.0,
              },
              {
                percentage: 50.0,
              },
            ],
          },
        ],
      }

      const insert = INSERT.into(entity).entries(entry)

      await cds.db.run(insert)

      const root = { uniqueName: entry.uniqueName, realm: entry.realm }

      // ensure keys are generated and propagated
      const dbState = await cds.db.run(
        SELECT.one
          .from(entity, h => {
            h`.*`,
              h.l1s(l1 => {
                l1`.*`, l1.l2s('*')
              })
          })
          .where(root),
      )

      const l1s = dbState.l1s
      const l2s = l1s[0].l2s

      expect(dbState).toMatchObject(root)

      expect(l1s).toMatchObject([
        {
          ID: expect.any(String),
          header_realm: entry.realm,
          header_uniqueName: entry.uniqueName,
        },
      ])

      expect(l2s).toMatchObject([
        {
          ID: expect.any(String),
          l1_ID: l1s[0].ID,
          l1_header_realm: entry.realm,
          l1_header_uniqueName: entry.uniqueName,
        },
        {
          ID: expect.any(String),
          l1_ID: l1s[0].ID,
          l1_header_realm: entry.realm,
          l1_header_uniqueName: entry.uniqueName,
        },
      ])
    })
  })
})
