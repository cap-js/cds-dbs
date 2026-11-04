const cds = require('@sap/cds')
const { expect } = cds.test
const { CQN2SQL } = require('../lib/HANAService')

describe('search similarity calculation mode SQL rendering', () => {
  let originalHana

  beforeEach(() => {
    originalHana = cds.env.hana
    cds.env.hana = { ...originalHana }
    delete cds.env.hana.fuzzy
    delete cds.env.hana.similarityCalculationMode
  })

  afterEach(() => {
    cds.env.hana = originalHana
  })

  /**
   * Renders a search expression without connecting to a database.
   * @param {object} ref Searchable column or column list.
   * @param {boolean} numeric Whether to render a relevance score.
   * @returns {string} Generated SQL.
   */
  function renderSearch(ref = { ref: ['title'] }, numeric = false) {
    const renderer = new CQN2SQL()
    renderer.values = []
    const args = [ref, { val: 'cat' }]
    if (numeric) args.push({ val: true })
    return renderer.expr({ func: 'search', args })
  }

  test('defaults to search', () => {
    expect(renderSearch()).to.equal(
      "(CASE WHEN SCORE(? IN title FUZZY MINIMAL SCORE 0.7 SIMILARITY CALCULATION MODE 'search') > 0 THEN TRUE ELSE FALSE END)",
    )
  })

  test('accepts each documented mode', () => {
    for (const mode of [
      'compare', 'type ahead', 'search compare', 'search', 'symmetric search', 'substring search', 'flexible',
    ]) {
      cds.env.hana.similarityCalculationMode = mode
      expect(renderSearch()).to.include(`SIMILARITY CALCULATION MODE '${mode}'`)
    }
  })

  test('preserves numeric and object fuzziness configuration', () => {
    cds.env.hana.similarityCalculationMode = 'substring search'
    for (const fuzzy of [0.9, { score: 0.9, ranked_search: false }]) {
      cds.env.hana.fuzzy = fuzzy
      expect(renderSearch()).to.include("FUZZY MINIMAL SCORE 0.9 SIMILARITY CALCULATION MODE 'substring search'")
    }
  })

  test('applies the mode to an unannotated column list', () => {
    cds.env.hana.similarityCalculationMode = 'substring search'
    const sql = renderSearch({ list: [{ ref: ['title'] }, { ref: ['descr'] }] })
    expect(sql).to.include("(title,descr) FUZZY MINIMAL SCORE 0.7 SIMILARITY CALCULATION MODE 'substring search'")
  })

  test('preserves the default for an annotated column', () => {
    const sql = renderSearch({
      ref: ['title'],
      element: { '@Search.ranking': { '=': 'HIGH' }, '@Search.fuzzinessThreshold': 0.9 },
    })
    expect(sql).to.include("title FUZZY WEIGHT 0.8 MINIMAL SCORE 0.9 SIMILARITY CALCULATION MODE 'search'")
  })

  test('applies the mode to an annotated single column', () => {
    cds.env.hana.similarityCalculationMode = 'substring search'
    const sql = renderSearch({
      ref: ['title'],
      element: { '@Search.fuzzinessThreshold': 0.9 },
    })
    expect(sql).to.include("title FUZZY WEIGHT 0.5 MINIMAL SCORE 0.9 SIMILARITY CALCULATION MODE 'substring search'")
  })

  test('applies the mode to every column when one column is annotated', () => {
    cds.env.hana.similarityCalculationMode = 'substring search'
    const sql = renderSearch({
      list: [
        { ref: ['title'], element: { '@Search.ranking': { '=': 'HIGH' } } },
        { ref: ['descr'] },
      ],
    })
    expect(sql).to.include("title FUZZY WEIGHT 0.8 MINIMAL SCORE 0.7 SIMILARITY CALCULATION MODE 'substring search'")
    expect(sql).to.include("descr FUZZY WEIGHT 0.5 MINIMAL SCORE 0.7 SIMILARITY CALCULATION MODE 'substring search'")
  })

  test('uses the same mode for the predicate and repeated numeric rendering', () => {
    cds.env.hana.similarityCalculationMode = 'substring search'
    const ref = {
      list: [
        { ref: ['title'], element: { '@Search.ranking': { '=': 'HIGH' } } },
        { ref: ['descr'] },
      ],
    }
    const predicate = renderSearch(ref)
    const score = renderSearch(ref, true)
    expect(predicate).to.equal(`(CASE WHEN ${score} > 0 THEN TRUE ELSE FALSE END)`)
    expect(score).to.include("SIMILARITY CALCULATION MODE 'substring search'")
    expect(score).not.to.include('undefined')
  })

  test('rejects invalid values instead of embedding them in SQL', () => {
    for (const mode of ['', 'sub string search', 'SEARCH', "search' INJECTED SQL", false, 1, {}, []]) {
      cds.env.hana.similarityCalculationMode = mode
      expect(() => renderSearch()).to.throw(/Invalid configuration .* for cds\.hana\.similarityCalculationMode/)
    }
  })

  test('ignores the setting when fuzzy search is disabled', () => {
    cds.env.hana.fuzzy = false
    cds.env.hana.similarityCalculationMode = 'invalid'
    const sql = renderSearch()
    expect(sql).to.include('lower(title) like ?')
    expect(sql).not.to.include('SIMILARITY CALCULATION MODE')
    expect(sql).not.to.include('SCORE(')
  })
})
