import React, { useState, useEffect, useRef, useCallback } from 'react';
import io from 'socket.io-client';
import Peer from 'simple-peer';
import appConfig from '../../config.json';

export default function ChatTab({ connected, publicIp }) {
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');
  const [onlineUsers, setOnlineUsers] = useState([]);
  const [inVoiceChannel, setInVoiceChannel] = useState(false);
  const [voiceUsers, setVoiceUsers] = useState([]);
  const [pttActive, setPttActive] = useState(false); // PTT tuşuna basılı mı?
  const [userVolumes, setUserVolumes] = useState({});
  const [contextMenu, setContextMenu] = useState(null);

  const socketRef = useRef(null);
  const myStreamRef = useRef(null);
  const gainNodeRef = useRef(null);   // Canlı gain güncellemesi için
  const peersRef = useRef({});
  const audioRefs = useRef({});
  const messagesEndRef = useRef(null);

  const getNickname = () => {
    try {
      const s = localStorage.getItem('nexus_settings');
      if (s) {
        const p = JSON.parse(s);
        if (p.nickname && p.nickname.trim().length > 0) return p.nickname;
      }
    } catch (e) {}
    return 'Oyuncu_' + Math.random().toString(36).substring(2, 6);
  };

  const [username, setUsername] = useState(getNickname());

  const getMasterVolume = () => {
    try {
      const s = JSON.parse(localStorage.getItem('nexus_settings'));
      if (s && s.masterVolume !== undefined) return s.masterVolume / 100;
    } catch (e) {}
    return 1;
  };

  const getSettings = () => {
    try {
      return JSON.parse(localStorage.getItem('nexus_settings') || '{}');
    } catch (e) {
      return {};
    }
  };

  // Ayarlar değişince canlı güncelle (gain, master volume)
  useEffect(() => {
    const onSettingsUpdate = (e) => {
      const s = e.detail || {};

      // Nickname güncelleme
      const newName = s.nickname && s.nickname.trim().length > 0 ? s.nickname : getNickname();
      setUsername(newName);
      if (socketRef.current) {
        socketRef.current.emit('update_profile', { username: newName });
      }

      // Master volume → tüm kullanıcıların audio elementlerini güncelle
      const master = (s.masterVolume !== undefined ? s.masterVolume : 100) / 100;
      Object.keys(audioRefs.current).forEach(id => {
        if (audioRefs.current[id]) {
          const userVol = userVolumes[id] !== undefined ? userVolumes[id] : 100;
          audioRefs.current[id].volume = (userVol / 100) * master;
        }
      });

      // Canlı Mic Gain güncelleme — tekrar bağlanmaya gerek YOK
      if (gainNodeRef.current) {
        const newGain = (s.micGain !== undefined ? s.micGain : 100) / 100;
        gainNodeRef.current.gain.setTargetAtTime(newGain, gainNodeRef.current.context.currentTime, 0.05);
      }
    };

    const onProfileUpdate = () => {
      const newName = getNickname();
      setUsername(newName);
      if (socketRef.current) {
        socketRef.current.emit('update_profile', { username: newName });
      }
    };

    const onClickClose = () => setContextMenu(null);

    window.addEventListener('nexus_settings_update', onSettingsUpdate);
    window.addEventListener('nexus_profile_update', onProfileUpdate);
    window.addEventListener('click', onClickClose);

    return () => {
      window.removeEventListener('nexus_settings_update', onSettingsUpdate);
      window.removeEventListener('nexus_profile_update', onProfileUpdate);
      window.removeEventListener('click', onClickClose);
    };
  }, [userVolumes]);

  // PTT tuş dinleyicisi
  useEffect(() => {
    const onKeyDown = (e) => {
      const s = getSettings();
      if (!s.pttEnabled || !inVoiceChannel) return;
      if (e.code === (s.pttKey || 'CapsLock')) {
        e.preventDefault();
        setPttActive(true);
        if (myStreamRef.current) {
          myStreamRef.current.getAudioTracks().forEach(t => { t.enabled = true; });
        }
      }
    };
    const onKeyUp = (e) => {
      const s = getSettings();
      if (!s.pttEnabled || !inVoiceChannel) return;
      if (e.code === (s.pttKey || 'CapsLock')) {
        e.preventDefault();
        setPttActive(false);
        if (myStreamRef.current) {
          myStreamRef.current.getAudioTracks().forEach(t => { t.enabled = false; });
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [inVoiceChannel]);

  useEffect(() => {
    if (!connected) return;

    socketRef.current = io(`http://${appConfig.serverIp}:51821`);

    socketRef.current.on('connect', () => {
      socketRef.current.emit('join_network', { username: getNickname(), lanIp: publicIp });
    });
    socketRef.current.on('online_users', (users) => setOnlineUsers(users));
    socketRef.current.on('chat_message', (msg) => {
      setMessages(prev => [...prev, msg]);
      setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
    });

    const createPeer = (targetId, initiator) => {
      const peer = new Peer({
        initiator,
        trickle: false,
        stream: myStreamRef.current,
        config: { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] }
      });
      peer.on('signal', signal => {
        if (initiator) {
          socketRef.current.emit('voice_offer', { targetId, callerInfo: { username: getNickname() }, sdp: signal });
        } else {
          socketRef.current.emit('voice_answer', { targetId, sdp: signal });
        }
      });
      peer.on('stream', userStream => {
        if (audioRefs.current[targetId]) {
          audioRefs.current[targetId].srcObject = userStream;
          const vol = userVolumes[targetId] !== undefined ? userVolumes[targetId] : 100;
          audioRefs.current[targetId].volume = (vol / 100) * getMasterVolume();
        }
      });
      return peer;
    };

    socketRef.current.on('voice_channel_users', (usersInChannel) => {
      setVoiceUsers(usersInChannel);
      usersInChannel.forEach(userId => {
        peersRef.current[userId] = createPeer(userId, true);
      });
    });
    socketRef.current.on('voice_offer', (data) => {
      setVoiceUsers(prev => prev.includes(data.callerId) ? prev : [...prev, data.callerId]);
      const peer = createPeer(data.callerId, false);
      peer.signal(data.sdp);
      peersRef.current[data.callerId] = peer;
    });
    socketRef.current.on('voice_answer', (data) => {
      if (peersRef.current[data.answererId]) peersRef.current[data.answererId].signal(data.sdp);
    });
    socketRef.current.on('ice_candidate', (data) => {
      if (peersRef.current[data.fromId]) peersRef.current[data.fromId].signal(data.candidate);
    });
    socketRef.current.on('user_left_voice', (userId) => {
      if (peersRef.current[userId]) { peersRef.current[userId].destroy(); delete peersRef.current[userId]; }
      setVoiceUsers(prev => prev.filter(id => id !== userId));
    });

    return () => {
      if (myStreamRef.current) myStreamRef.current.getTracks().forEach(t => t.stop());
      Object.values(peersRef.current).forEach(peer => peer.destroy());
      socketRef.current.disconnect();
    };
  }, [connected]);

  const joinVoice = async () => {
    try {
      const s = getSettings();

      const rawStream = await navigator.mediaDevices.getUserMedia({
        video: false,
        audio: {
          deviceId: s.micDeviceId && s.micDeviceId !== 'default' ? { exact: s.micDeviceId } : undefined,
          autoGainControl: false,
          echoCancellation: false,
          noiseSuppression: false,
        }
      });

      let finalStream = rawStream;
      let active = true;

      try {
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const source = audioCtx.createMediaStreamSource(rawStream);

        // Gain node — ref ile canlı güncellenebilir
        const gainNode = audioCtx.createGain();
        gainNode.gain.value = (s.micGain !== undefined ? s.micGain : 100) / 100;
        gainNodeRef.current = gainNode;

        source.connect(gainNode);

        const destination = audioCtx.createMediaStreamDestination();

        if (s.noiseGate) {
          const analyser = audioCtx.createAnalyser();
          analyser.fftSize = 512;
          const gateGain = audioCtx.createGain();
          gateGain.gain.value = 1;
          gainNode.connect(analyser);
          analyser.connect(gateGain);
          gateGain.connect(destination);

          const dataArray = new Uint8Array(analyser.frequencyBinCount);
          let noiseFloor = s.gateThreshold || 8;
          let lastAbove = audioCtx.currentTime;

          if (s.autoGate) {
            let samples = [];
            const calibrateEnd = audioCtx.currentTime + 1.5;
            const calibrate = () => {
              if (!active) return;
              if (audioCtx.currentTime < calibrateEnd) {
                analyser.getByteFrequencyData(dataArray);
                samples.push(dataArray.reduce((a, b) => a + b, 0) / dataArray.length);
                requestAnimationFrame(calibrate);
              } else {
                noiseFloor = Math.max(2, (samples.reduce((a, b) => a + b, 0) / samples.length) * 2.5);
              }
            };
            calibrate();
          }

          let gateLoop;
          const checkGate = () => {
            if (!active) return;
            analyser.getByteFrequencyData(dataArray);
            const avg = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;
            if (avg > noiseFloor) {
              lastAbove = audioCtx.currentTime;
              gateGain.gain.setTargetAtTime(1, audioCtx.currentTime, 0.02);
            } else if (audioCtx.currentTime - lastAbove > 0.4) {
              gateGain.gain.setTargetAtTime(0, audioCtx.currentTime, 0.08);
            }
            gateLoop = requestAnimationFrame(checkGate);
          };
          checkGate();

          finalStream = destination.stream;
          finalStream._cleanup = () => {
            active = false;
            if (gateLoop) cancelAnimationFrame(gateLoop);
            audioCtx.close().catch(() => {});
          };
        } else {
          gainNode.connect(destination);
          finalStream = destination.stream;
          finalStream._cleanup = () => {
            active = false;
            audioCtx.close().catch(() => {});
          };
        }

        finalStream._rawStream = rawStream;
      } catch (e) {
        console.error('Audio pipeline hatası:', e);
      }

      // PTT açıksa başlangıçta mikrofonları kapat
      if (s.pttEnabled) {
        finalStream.getAudioTracks().forEach(t => { t.enabled = false; });
      }

      myStreamRef.current = finalStream;
      setInVoiceChannel(true);
      socketRef.current.emit('join_voice_channel');
    } catch (err) {
      console.error('Mikrofon hatası:', err);
      alert('Mikrofona erişilemedi!');
    }
  };

  const leaveVoice = () => {
    setInVoiceChannel(false);
    gainNodeRef.current = null;
    socketRef.current.emit('leave_voice_channel');
    if (myStreamRef.current) {
      if (myStreamRef.current._rawStream) myStreamRef.current._rawStream.getTracks().forEach(t => t.stop());
      if (myStreamRef.current._cleanup) myStreamRef.current._cleanup();
      myStreamRef.current.getTracks().forEach(t => t.stop());
      myStreamRef.current = null;
    }
    Object.values(peersRef.current).forEach(peer => peer.destroy());
    peersRef.current = {};
    setVoiceUsers([]);
    setPttActive(false);
  };

  const handleVolumeChange = (userId, vol) => {
    setUserVolumes(prev => ({ ...prev, [userId]: vol }));
    if (audioRefs.current[userId]) {
      audioRefs.current[userId].volume = (vol / 100) * getMasterVolume();
    }
  };

  const handleContextMenu = (e, userId) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, userId });
  };

  const sendMessage = (e) => {
    e.preventDefault();
    if (!text.trim()) return;
    const msg = { text, sender: username, time: Date.now() };
    socketRef.current.emit('chat_message', msg);
    setMessages(prev => [...prev, msg]);
    setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
    setText('');
  };

  if (!connected) {
    return (
      <div className="alert alert-info">
        <span>ℹ️</span>
        <span>Sohbet etmek ve ağdakileri görmek için VPN'e bağlanmalısınız.</span>
      </div>
    );
  }

  const pttEnabled = getSettings().pttEnabled;
  const pttKey = getSettings().pttKey || 'CapsLock';

  return (
    <div style={{ display: 'flex', gap: '10px', height: '100%', overflow: 'hidden' }}>

      {/* Context Menü */}
      {contextMenu && (
        <div
          onClick={e => e.stopPropagation()}
          style={{
            position: 'fixed', top: contextMenu.y, left: contextMenu.x,
            background: 'var(--bg-card)', border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: '8px', padding: '10px', zIndex: 9999,
            boxShadow: '0 4px 15px rgba(0,0,0,0.5)', width: '150px'
          }}
        >
          <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '8px' }}>Ses Seviyesi</div>
          <input
            type="range" min="0" max="200"
            value={userVolumes[contextMenu.userId] !== undefined ? userVolumes[contextMenu.userId] : 100}
            onChange={(e) => handleVolumeChange(contextMenu.userId, parseInt(e.target.value))}
            style={{ width: '100%', height: '4px', accentColor: 'var(--accent-purple)' }}
          />
          <button
            onClick={() => handleVolumeChange(contextMenu.userId, 0)}
            style={{ width: '100%', marginTop: '10px', background: '#ff4757', border: 'none', color: 'white', padding: '4px', borderRadius: '4px', cursor: 'pointer', fontSize: '11px' }}
          >
            <i className="fas fa-volume-mute"></i> Sustur
          </button>
        </div>
      )}

      {/* Görünmez Audio Elementleri */}
      {voiceUsers.map(userId => (
        <audio
          key={userId}
          ref={el => {
            if (el) {
              audioRefs.current[userId] = el;
              const vol = userVolumes[userId] !== undefined ? userVolumes[userId] : 100;
              el.volume = (vol / 100) * getMasterVolume();
            }
          }}
          autoPlay
        />
      ))}

      {/* Sol Panel */}
      <div className="glass-card" style={{ width: '150px', padding: '10px', display: 'flex', flexDirection: 'column', gap: '15px', overflowY: 'auto' }}>
        <div>
          <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '8px', fontWeight: 'bold' }}>SES KANALI</div>
          <div style={{ background: 'rgba(0,0,0,0.2)', padding: '8px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.05)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px' }}>
              <i className="fas fa-volume-up"></i>
              <span style={{ fontSize: '12px', fontWeight: 'bold' }}>Grup Odası</span>
            </div>

            {/* PTT Göstergesi */}
            {inVoiceChannel && pttEnabled && (
              <div style={{
                textAlign: 'center', fontSize: '10px', padding: '4px 6px', borderRadius: '4px', marginBottom: '8px',
                background: pttActive ? 'rgba(0,212,170,0.2)' : 'rgba(255,255,255,0.05)',
                border: `1px solid ${pttActive ? '#00d4aa' : 'rgba(255,255,255,0.1)'}`,
                color: pttActive ? '#00d4aa' : 'var(--text-muted)',
                transition: 'all 0.1s'
              }}>
                {pttActive ? (
                  <><i className="fas fa-microphone"></i> Konuşuyor</>
                ) : (
                  <><i className="fas fa-microphone-slash"></i> {pttKey}</>
                )}
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '10px', paddingLeft: '10px', borderLeft: '2px solid var(--accent-purple)' }}>
              {inVoiceChannel && (
                <div style={{ fontSize: '11px', color: '#00d4aa', fontWeight: 'bold' }}>- {username} (Sen)</div>
              )}
              {voiceUsers.map(userId => {
                const u = onlineUsers.find(x => x.id === userId);
                const vol = userVolumes[userId] !== undefined ? userVolumes[userId] : 100;
                const isMuted = vol === 0;
                return (
                  <div
                    key={userId}
                    onContextMenu={(e) => handleContextMenu(e, userId)}
                    style={{ fontSize: '11px', color: isMuted ? '#ff4757' : 'var(--text-secondary)', cursor: 'context-menu', display: 'flex', alignItems: 'center', gap: '4px' }}
                    title="Ses ayarı için sağ tıkla"
                  >
                    <span>- {u ? u.username : 'Oyuncu'}</span>
                    {isMuted && <i className="fas fa-volume-mute" style={{ fontSize: '9px' }}></i>}
                  </div>
                );
              })}
              {!inVoiceChannel && voiceUsers.length === 0 && (
                <div style={{ fontSize: '10px', color: 'var(--text-muted)' }}>Oda boş</div>
              )}
            </div>

            {!inVoiceChannel ? (
              <button onClick={joinVoice} style={{ width: '100%', padding: '6px', background: 'var(--accent-purple)', color: 'white', border: 'none', borderRadius: '4px', fontWeight: 'bold', fontSize: '11px', cursor: 'pointer' }}>
                Katıl
              </button>
            ) : (
              <button onClick={leaveVoice} style={{ width: '100%', padding: '6px', background: '#ff4757', color: 'white', border: 'none', borderRadius: '4px', fontWeight: 'bold', fontSize: '11px', cursor: 'pointer' }}>
                Ayrıl
              </button>
            )}
          </div>
        </div>

        <div>
          <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '10px', fontWeight: 'bold' }}>AĞDAKİLER ({onlineUsers.length})</div>
          {onlineUsers.map(user => (
            <div key={user.id} style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px' }}>
              <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#00d4aa' }} />
              <div style={{ fontSize: '11px', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {user.username === username ? 'Sen' : user.username}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Sağ Panel: Yazılı Sohbet */}
      <div className="glass-card" style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '10px', overflow: 'hidden' }}>
        <div style={{ fontSize: '12px', fontWeight: 'bold', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '8px', marginBottom: '8px', flexShrink: 0 }}>
          <i className="fas fa-comments" style={{ marginRight: '6px' }}></i> Ağ Sohbeti
        </div>
        <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {messages.map((m, i) => (
            <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: m.sender === username ? 'flex-end' : 'flex-start' }}>
              <div style={{ fontSize: '9px', color: 'var(--text-muted)', marginBottom: '2px' }}>{m.sender}</div>
              <div style={{
                background: m.sender === username ? 'var(--accent-purple)' : 'rgba(255,255,255,0.1)',
                padding: '6px 10px', borderRadius: '8px', fontSize: '12px'
              }}>
                {m.text}
              </div>
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>
        <form onSubmit={sendMessage} style={{ display: 'flex', gap: '8px', marginTop: '10px' }}>
          <input
            type="text" value={text} onChange={e => setText(e.target.value)}
            placeholder="Mesaj yaz..."
            style={{ flex: 1, background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.1)', color: 'white', borderRadius: '20px', padding: '8px 12px', fontSize: '12px' }}
          />
          <button type="submit" style={{ background: 'var(--accent-purple)', border: 'none', borderRadius: '20px', padding: '8px 16px', color: 'white', fontWeight: 'bold', cursor: 'pointer' }}>
            Gönder
          </button>
        </form>
      </div>
    </div>
  );
}
