'use strict'
const { pathToFileURL } = require('node:url')

function isTrustedFrame(event, webContents, { isDev = false, indexPath } = {}) {
  if (!webContents || event?.sender !== webContents || !event.senderFrame || event.senderFrame !== webContents.mainFrame) return false
  try {
    const sender = new URL(event.senderFrame.url)
    if (isDev) return sender.origin === 'http://localhost:5173'
    if (!indexPath) return false
    const expected = pathToFileURL(indexPath)
    return sender.protocol === 'file:' && sender.pathname === expected.pathname && sender.host === expected.host && !sender.search
  } catch { return false }
}
module.exports = { isTrustedFrame }
