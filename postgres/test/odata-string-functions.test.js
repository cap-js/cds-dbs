const cds = require('../../test/cds.js')
const project = require('path').resolve(__dirname, 'beershop')

process.env.DEBUG && jest.setTimeout(100000)

describe('String + Collection functions', () => {
  const { GET, expect, data } = cds.test('serve', '--project', project).verbose()

  data.autoIsolation(true)
  data.autoReset(true)

  test('concat', async () => {
    const response = await GET(`/beershop/Beers?$filter=concat(name,' ---discount!') eq 'Lagerbier Hell ---discount!'`)
    expect(response.status).to.equal(200)
    expect(response.data.value.map(beer => beer.name)).to.include('Lagerbier Hell')
  })
  test('contains', async () => {
    const response = await GET(`/beershop/Beers?$filter=contains(name,'Lager')`)
    expect(response.status).to.equal(200)
    expect(response.data.value.map(beer => beer.name)).to.include('Lagerbier Hell')
  })

  test('endswith', async () => {
    const response = await GET(`/beershop/Beers?$filter=endswith(name,'ramer Hell')`)
    expect(response.status).to.equal(200)
    expect(response.data.value.map(beer => beer.name)).to.include('Schönramer Hell')
  })

  test('indexof', async () => {
    const response = await GET(`/beershop/Beers?$filter=indexof(name,'ch') eq 1`)
    expect(response.status).to.equal(200)
    expect(response.data.value.length).to.equal(1)
    expect(response.data.value.map(beer => beer.name)).to.include('Schönramer Hell')
  })

  test('ANDed indexof', async () => {
    const response = await GET(`/beershop/Beers?$filter=indexof(name,'ch') eq 1 and indexof(name,'Sch') eq 0`)
    expect(response.status).to.equal(200)
    expect(response.data.value.length).to.equal(1)
    expect(response.data.value.map(beer => beer.name)).to.include('Schönramer Hell')
  })

  test('ORed indexof', async () => {
    const response = await GET(`/beershop/Beers?$filter=indexof(name,'ch') eq 1 or indexof(name,'Sch') eq 0`)
    expect(response.status).to.equal(200)
    expect(response.data.value.length).to.equal(1)
    expect(response.data.value.map(beer => beer.name)).to.include('Schönramer Hell')
  })

  test('length', async () => {
    const response = await GET(`/beershop/Beers?$filter=length(name) eq 14`)
    expect(response.status).to.equal(200)
    expect(response.data.value.length).to.equal(1)
    expect(response.data.value.map(beer => beer.name)).to.include('Lagerbier Hell')
  })

  test('startswith', async () => {
    // cf needs the umlauts pre-encoded
    const response = await GET(`/beershop/Beers?$filter=startswith(name,'${encodeURIComponent('Schön')}')`)
    expect(response.status).to.equal(200)
    expect(response.data.value.length).to.equal(1)
    expect(response.data.value.map(beer => beer.name)).to.include('Schönramer Hell')
  })

  test('substring (from)', async () => {
    const response = await GET(`/beershop/Beers?$filter=substring(name,1) eq '${encodeURIComponent('chönramer Hell')}'`)
    expect(response.status).to.equal(200)
    expect(response.data.value.length).to.equal(1)
    expect(response.data.value.map(beer => beer.name)).to.include('Schönramer Hell')
  })

  test('substring (from,to)', async () => {
    const response = await GET(`/beershop/Beers?$filter=substring(name,1,3) eq 'age'`)
    expect(response.status).to.equal(200)
    expect(response.data.value.length).to.equal(1)
    expect(response.data.value.map(beer => beer.name)).to.include('Lagerbier Hell')
  })

  // not support by odata server yet!
  test.skip('matchesPattern', async () => {
    const response = await GET(`/beershop/Beers?$filter=matchesPattern(name,/.*Hell$/`)
    expect(response.status).to.equal(200)
    expect(response.data.value.length).to.equal(2)
    expect(response.data.value.map(beer => beer.name)).to.include('Lagerbier Hell')
    expect(response.data.value.map(beer => beer.name)).to.include('Schönramer Hell')
  })

  test('tolower', async () => {
    // cf needs the umlauts pre-encoded
    const response = await GET(`/beershop/Beers?$filter=tolower(name) eq '${encodeURIComponent('schönramer hell')}'`)
    expect(response.status).to.equal(200)
    expect(response.data.value.length).to.equal(1)
    expect(response.data.value.map(beer => beer.name)).to.include('Schönramer Hell')
  })

  test('toupper w/o special chars in eq', async () => {
    const response = await GET(`/beershop/Beers?$filter=toupper(name) eq 'HALLERNDORFER LANDBIER HELL'`)
    expect(response.status).to.equal(200)
    expect(response.data.value.length).to.equal(1)
    expect(response.data.value.map(beer => beer.name)).to.include('Hallerndorfer Landbier Hell')
  })

  test('toupper w/ special chars in eq', async () => {
    // cf needs the umlauts pre-encoded
    const response = await GET(`/beershop/Beers?$filter=toupper(name) eq '${encodeURIComponent('SCHÖNRAMER HELL')}'`)
    expect(response.status).to.equal(200)
    expect(response.data.value.length).to.equal(1)
    expect(response.data.value.map(beer => beer.name)).to.include('Schönramer Hell')
  })

  test('trim', async () => {
    const response = await GET(`/beershop/Beers?$filter=trim(name) eq name`)
    expect(response.status).to.equal(200)
    expect(response.data.value.length).to.be.greaterThanOrEqual(2)
    expect(response.data.value.map(beer => beer.name)).to.include('Lagerbier Hell')
    expect(response.data.value.map(beer => beer.name)).to.include('Schönramer Hell')
  })

  test('case-sensitive + -insensitive', async () => {
    const responseSensitive = await GET(`/beershop/Beers?$filter=contains(name,'Bi')`)
    expect(responseSensitive.status).to.equal(200)
    expect(responseSensitive.data.value.length).to.equal(1)
    expect(responseSensitive.data.value.map(beer => beer.name)).to.include('Bitter 42')
    const responseInsensitive = await GET(`/beershop/Beers?$filter=contains(name,'bi')`)
    expect(responseInsensitive.status).to.equal(200)
    expect(responseInsensitive.data.value.length).to.equal(6)
    expect(responseInsensitive.data.value.map(beer => beer.name)).not.to.include('Bitter 42')
  })
})
