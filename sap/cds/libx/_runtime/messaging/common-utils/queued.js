module.exports = () => {
  let pending = Promise.resolve()
  return fn =>
    (...args) =>
      (pending = pending.then(() => fn(...args)))
}
