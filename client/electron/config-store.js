'use strict'
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const MAX_CONFIG_BYTES = 65536

function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
function parseConfig(text) {
  if (typeof text !== 'string' || Buffer.byteLength(text) > MAX_CONFIG_BYTES) throw new Error('Yapılandırma en fazla 64 KiB olabilir.')
  const value = JSON.parse(text)
  if (!object(value)) throw new Error('Yapılandırma bir JSON nesnesi olmalı.')
  return value
}
function readConfig(file) {
  const descriptor = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0))
  try {
    const stat = fs.fstatSync(descriptor)
    if (!stat.isFile() || stat.size > MAX_CONFIG_BYTES) throw new Error('Geçersiz veya çok büyük yapılandırma dosyası.')
    return parseConfig(fs.readFileSync(descriptor, 'utf8'))
  } finally { fs.closeSync(descriptor) }
}
function writeConfig(file, value) {
  if (!object(value)) throw new Error('Geçersiz yapılandırma.')
  const text = JSON.stringify(value, null, 2) + '\n'
  if (Buffer.byteLength(text) > MAX_CONFIG_BYTES) throw new Error('Yapılandırma en fazla 64 KiB olabilir.')
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
  try { if (fs.lstatSync(file).isSymbolicLink()) throw new Error('Yapılandırma sembolik bağlantı olamaz.') }
  catch (error) { if (error.code !== 'ENOENT') throw error }
  const temporary = path.join(path.dirname(file), `.${path.basename(file)}.${crypto.randomBytes(8).toString('hex')}.tmp`)
  let descriptor
  try {
    descriptor = fs.openSync(temporary, 'wx', 0o600)
    fs.writeFileSync(descriptor, text)
    fs.fsyncSync(descriptor)
    fs.closeSync(descriptor); descriptor = undefined
    fs.renameSync(temporary, file)
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor)
    try { fs.unlinkSync(temporary) } catch (error) { if (error.code !== 'ENOENT') throw error }
  }
}
module.exports = { MAX_CONFIG_BYTES, parseConfig, readConfig, writeConfig }
