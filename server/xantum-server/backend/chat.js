'use strict'
const { randomUUID, timingSafeEqual } = require('node:crypto')

function validToken(value, expected) {
  if (typeof value !== 'string' || typeof expected !== 'string') return false
  const a = Buffer.from(value), b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

function attachChat(io, { pin }) {
  const users = new Map()
  const name = value => typeof value === 'string' ? value.trim().slice(0, 48) : ''
  const publishUsers = () => io.emit('online_users', [...users.values()])
  const publishVoice = () => io.emit('voice_members', [...(io.sockets.adapter.rooms.get('voice_channel') || [])])
  io.use((socket, next) => next(validToken(socket.handshake.auth?.pin, pin) ? undefined : new Error('Katılım anahtarı geçersiz.')))
  io.on('connection', socket => {
    let windowStart = Date.now(), count = 0
    // A per-connection cap bounds deduplication memory and message rate.
    const accepted = new Map()
    socket.use((packet, next) => {
      if (Date.now() - windowStart >= 10000) { count = 0; windowStart = Date.now() }
      if (++count > 80) { socket.disconnect(true); return }
      next()
    })
    socket.on('join_network', data => {
      users.set(socket.id, { id: socket.id, username: name(data?.username) || 'Oyuncu' })
      publishUsers(); publishVoice()
    })
    socket.on('update_profile', data => {
      const user = users.get(socket.id)
      if (user && name(data?.username)) { user.username = name(data.username); publishUsers() }
    })
    socket.on('chat_message', (data, ack) => {
      const reply = typeof ack === 'function' ? ack : () => {}
      const user = users.get(socket.id)
      if (!user) return reply({ error: 'Önce ağa katılın.' })
      if (typeof data?.text !== 'string' || !data.text.trim() || data.text.length > 2000 ||
          typeof data?.clientId !== 'string' || data.clientId.length > 80) {
        return reply({ error: 'Mesaj 1–2000 karakter olmalı.' })
      }
      if (accepted.has(data.clientId)) return reply({ message: accepted.get(data.clientId) })
      const message = { id: randomUUID(), clientId: data.clientId, senderId: socket.id,
        sender: user.username, text: data.text.trim(), time: Date.now() }
      accepted.set(data.clientId, message)
      if (accepted.size > 200) accepted.delete(accepted.keys().next().value)
      socket.broadcast.emit('chat_message', message)
      reply({ message })
    })
    socket.on('join_voice_channel', (_, ack) => {
      const reply = typeof ack === 'function' ? ack : () => {}
      if (!users.has(socket.id)) return reply({ error: 'Önce ağa katılın.' })
      const members = io.sockets.adapter.rooms.get('voice_channel') || new Set()
      if (members.has(socket.id)) return reply({ ok: true })
      if (members.size >= 8) return reply({ error: 'Ses odası dolu (8 kişi).' })
      const existing = [...members]
      socket.join('voice_channel')
      // Only the joining client initiates. Existing members wait for its offer.
      socket.emit('voice_channel_users', existing)
      publishVoice()
      reply({ ok: true })
    })
    for (const [event, outgoing, senderKey, field] of [
      ['voice_offer', 'voice_offer', 'callerId', 'sdp'],
      ['voice_answer', 'voice_answer', 'answererId', 'sdp'],
      ['ice_candidate', 'ice_candidate', 'fromId', 'candidate'],
    ]) socket.on(event, data => {
      const members = io.sockets.adapter.rooms.get('voice_channel')
      if (!members?.has(socket.id) || !members.has(data?.targetId) || data.targetId === socket.id) return
      if (!data[field] || JSON.stringify(data[field]).length > 32768) return
      io.to(data.targetId).emit(outgoing, { [senderKey]: socket.id, [field]: data[field] })
    })
    socket.on('leave_voice_channel', () => {
      socket.leave('voice_channel')
      socket.to('voice_channel').emit('user_left_voice', socket.id)
      publishVoice()
    })
    socket.on('disconnect', () => {
      users.delete(socket.id)
      io.to('voice_channel').emit('user_left_voice', socket.id)
      publishUsers(); publishVoice()
    })
  })
}
module.exports = { attachChat, validToken }
