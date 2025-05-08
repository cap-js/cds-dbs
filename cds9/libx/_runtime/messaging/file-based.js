const cds = require('../cds')

const path = require('path')
const fs = require('fs').promises

const MessagingService = require('./service.js')

class FileBasedMessaging extends MessagingService {
  async init() {
    this.file = resolve(this.options.file || (this.options.credentials && this.options.credentials.file))
    try {
      await fs.lstat(this.file)
    } catch {
      await fs.writeFile(this.file, '\n')
    }
    cds.once('listening', () => {
      this.startWatching()
    })
    return super.init()
  }

  async handle(msg) {
    if (msg.inbound) return super.handle(msg)
    const _msg = this.message4(msg)
    const e = _msg.event
    delete _msg.event
    await this.queued(lock)(this.file)
    this.LOG._debug && this.LOG.debug('Emit', { topic: e, file: this.file })
    try {
      await fs.appendFile(this.file, `\n${e} ${JSON.stringify(_msg)}`)
    } catch (e) {
      this.LOG._debug && this.LOG.debug('Error', e)
    } finally {
      unlock(this.file)
    }
  }

  startWatching() {
    if (!this._listenToAll.value && !this.subscribedTopics.size) return
    const watcher = async () => {
      if (!(await touched(this.file, this.recent))) return // > not touched since last check
      // REVISIT: Bad if lock file wasn't cleaned up (due to crashes...)
      if (!(await this.queued(lock)(this.file, 1))) return // > file is locked -> try again next time
      try {
        const content = await fs.readFile(this.file, 'utf8')
        const lines = content.split('\n')
        const other = [] // used to collect non-matching entries
        for (const each of lines) {
          try {
            const match = /^([\s]*)([^\s]+) ({.*)/.exec(each)
            if (match) {
              const [, , topic, jsonString] = match
              const json = JSON.parse(jsonString)
              if (this.subscribedTopics.has(topic)) {
                const event = this.subscribedTopics.get(topic)
                if (!event) return
                try {
                  await this.processInboundMsg({}, { event, ...json })
                } catch (e) {
                  e.message = 'ERROR occurred in asynchronous event processing: ' + e.message
                  this.LOG.error(e)
                }
              } else other.push(each + '\n')
            }
          } catch {
            // ignore invalid messages
          }
        }
        if (other.length < lines.length) await fs.writeFile(this.file, other.join(''))
        this.recent = await touched(this.file)
      } catch (e) {
        this.LOG._debug && this.LOG.debug(e)
      } finally {
        unlock(this.file)
      }
    }
    this.watching = setInterval(watcher, this.options.interval || 500).unref()
  }

  disconnect() {
    this.watching = clearInterval(this.watching)
  }
}

const resolve = f => path.resolve(f.replace(/^~/, () => require('os').userInfo().homedir))
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const lock = async (file, n = 11) => {
  const lock = file + '.lock'
  try {
    while (n--) await fs.lstat(lock).then(() => n && sleep(150))
    return false
  } catch {
    // lock file does not exist -> create it
    await fs.writeFile(lock, 'locked')
    return true
  }
}
const unlock = file => fs.unlink(file + '.lock').catch(() => {})
const touched = (file, t0 = 0) =>
  fs.lstat(file).then(
    ({ ctimeMs: t }) => t > t0 && t,
    () => 0
  )

module.exports = FileBasedMessaging
