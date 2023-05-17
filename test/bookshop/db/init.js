/**
 * In order to keep basic bookshop sample as simple as possible, we don't add
 * reuse dependencies. This db/init.js ensures we still have a minimum set of
 * currencies, if not obtained through @capire/common.
 */

module.exports = async tx => {
  const has_common = tx.model.definitions['sap.common.Currencies']?.elements.numcode
  if (has_common) return

  const already_filled = await tx.exists('sap.common.Currencies', { code: 'EUR' })
  if (already_filled) return

  await tx.run(
    INSERT.into('sap.common.Currencies')
      .columns(['code', 'symbol', 'name'])
      .rows(
        ['EUR', '€', 'Euro'],
        ['USD', '$', 'US Dollar'],
        ['GBP', '£', 'British Pound'],
        ['ILS', '₪', 'Shekel'],
        ['JPY', '¥', 'Yen'],
      ),
  )
}
