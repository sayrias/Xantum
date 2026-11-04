require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { exec } = require('child_process');
const fs = require('fs');

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

// Güvenlik için ortam değişkeninden veya dosyadan PIN okunmalı
// Geliştirme aşamasında sabit:
const SERVER_PIN = process.env.VPN_PIN || '123456';
const SERVER_IP = process.env.VPN_IP || '127.0.0.1'; // Setup.sh bunu düzeltecek

// POST /register - İstemci uygulaması ilk açıldığında otomatik istek atar
app.post('/register', (req, res) => {
  const { pin, publicKey } = req.body;

  if (pin !== SERVER_PIN) {
    return res.status(403).json({ error: 'Geçersiz Katılım Şifresi' });
  }

  if (!publicKey) {
    return res.status(400).json({ error: 'Public Key gerekli' });
  }

  // add-peer.sh scriptini çalıştırarak wireguard'a ekle ve configi al
  // NOT: add-peer.sh root gerektirdiği için nodejs process'inin yetkisi olmalı veya sudo ayarlanmalı.
  // Burada add-peer.sh içindeki yapıyı kullanarak yeni IP vereceğiz.

  // Güvenli isim oluştur
  const peerName = 'peer_' + Math.random().toString(36).substring(2, 9);

  exec(`sudo /usr/local/bin/xantum/add-peer-api.sh "${peerName}" "${publicKey}"`, (err, stdout, stderr) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ error: 'VPN kaydı yapılamadı.' });
    }

    // add-peer-api.sh JSON formatında dönecek şekilde ayarlanacak
    try {
      const configData = JSON.parse(stdout);
      res.json({ success: true, config: configData });
    } catch (parseErr) {
      res.status(500).json({ error: 'Sunucu çıktısı okunamadı', raw: stdout });
    }
  });
});

// Socket.IO (Chat ve Sesli Arama - WebRTC Sinyal)
let onlineUsers = {};

io.on('connection', (socket) => {
  console.log('Bir kullanıcı bağlandı:', socket.id);

  socket.on('join_network', (data) => {
    // data = { username, lanIp }
    onlineUsers[socket.id] = { ...data, id: socket.id };
    io.emit('online_users', Object.values(onlineUsers));
  });

  socket.on('chat_message', (msg) => {
    // msg = { text, sender: username, time: Date.now() }
    socket.broadcast.emit('chat_message', msg);
  });

  socket.on('update_profile', (data) => {
    if (onlineUsers[socket.id]) {
      onlineUsers[socket.id].username = data.username;
      io.emit('online_users', Object.values(onlineUsers));
    }
  });

  // WebRTC Sinyalleşme - Group Voice Channel (Mesh)
  socket.on('join_voice_channel', () => {
    // Sadece ses kanalında olanlara sinyal göndermek için bir odaya katılalım
    socket.join('voice_channel');

    // Odada daha önceden olan diğer kişileri bulup, yeni gelene haber ver
    const clients = io.sockets.adapter.rooms.get('voice_channel');
    const existingUsers = [];
    if (clients) {
      clients.forEach(clientId => {
        if (clientId !== socket.id) {
          existingUsers.push(clientId);
        }
      });
    }
    // Yeni kullanıcıya odadakilerin listesini gönder, ki onlara 'offer' atabilsin
    socket.emit('voice_channel_users', existingUsers);
  });

  socket.on('voice_offer', (data) => {
    // data = { targetId, sdp, callerInfo }
    io.to(data.targetId).emit('voice_offer', { callerId: socket.id, sdp: data.sdp, callerInfo: data.callerInfo });
  });

  socket.on('voice_answer', (data) => {
    // data = { targetId, sdp }
    io.to(data.targetId).emit('voice_answer', { answererId: socket.id, sdp: data.sdp });
  });

  socket.on('ice_candidate', (data) => {
    io.to(data.targetId).emit('ice_candidate', { fromId: socket.id, candidate: data.candidate });
  });

  socket.on('leave_voice_channel', () => {
    socket.leave('voice_channel');
    // Odadaki diğerlerine çıktığını haber ver
    socket.to('voice_channel').emit('user_left_voice', socket.id);
  });

  socket.on('disconnect', () => {
    delete onlineUsers[socket.id];
    io.emit('online_users', Object.values(onlineUsers));
    socket.to('voice_channel').emit('user_left_voice', socket.id);
  });
});

const PORT = 51821;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Xantum API ve Sinyal Sunucusu ${PORT} portunda çalışıyor.`);
});
