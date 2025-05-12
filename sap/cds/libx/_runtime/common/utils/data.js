// REVISIT: remove once not needed anymore
const getDataFromCQN = query => (query.INSERT && query.INSERT.entries) || (query.UPDATE && query.UPDATE.data)

// REVISIT: remove once not needed anymore
const setDataFromCQN = req => {
  if (Array.isArray(req.data)) {
    req.data = req.query.INSERT && req.query.INSERT.entries
  } else {
    req.data = (req.query.INSERT && req.query.INSERT.entries[0]) || (req.query.UPDATE && req.query.UPDATE.data)
  }
}

module.exports = {
  getDataFromCQN,
  setDataFromCQN
}
