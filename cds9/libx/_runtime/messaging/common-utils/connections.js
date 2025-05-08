const waitingTime = require('../../common/utils/waitingTime')

const _connectUntilConnected = (client, LOG, x) => {
  const _waitingTime = waitingTime(x)
  setTimeout(() => {
    connect(client, LOG, true)
      .then(() => {
        LOG._warn && LOG.warn('Reconnected to Enterprise Messaging Client')
      })
      .catch(() => {
        LOG._warn &&
          LOG.warn(
            `Connection to Enterprise Messaging Client lost: Reconnecting in ${Math.round(_waitingTime / 1000)} s`
          )
        _connectUntilConnected(client, LOG, x + 1)
      })
  }, _waitingTime)
}

const connect = (client, LOG, keepAlive) => {
  return new Promise((resolve, reject) => {
    client
      .once('connected', function () {
        client.removeAllListeners('error')

        client.once('error', err => {
          if (LOG._error) {
            err.message = 'Client error: ' + err.message
            LOG.error(err)
          }
          if (keepAlive) {
            client.removeAllListeners('error')
            client.removeAllListeners('connected')
            _connectUntilConnected(client, LOG, 0)
          }
        })

        if (keepAlive) {
          client.once('disconnected', () => {
            client.removeAllListeners('error')
            client.removeAllListeners('connected')
            _connectUntilConnected(client, LOG, 0)
          })
        }

        resolve(this)
      })
      .once('error', err => {
        client.removeAllListeners('connected')
        reject(err)
      })

    client.connect()
  })
}

const disconnect = client => {
  return new Promise((resolve, reject) => {
    client.removeAllListeners('disconnected')
    client.removeAllListeners('connected')
    client.removeAllListeners('error')

    client.once('disconnected', () => {
      client.removeAllListeners('error')
      resolve()
    })
    client.once('error', err => {
      client.removeAllListeners('disconnected')
      reject(err)
    })

    client.disconnect()
  })
}

module.exports = {
  connect,
  disconnect
}
