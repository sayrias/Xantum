import { t, useLocale } from '../i18n/useLocale.jsx'
import React, { useState, useEffect, useRef, useCallback } from 'react';
import io from 'socket.io-client';
import Peer from 'simple-peer/simplepeer.min.js';
import '../styles/chat.css';

const initials = name => Array.from(String(name || t("Oyuncu")).trim().split(/\s+/).slice(0, 2).map(part => Array.from(part)[0] || '')).join('').toUpperCase();
const messageTime = value => {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
};

export default function ChatTab({ connected }) {
  const { locale, numberLocale } = useLocale()
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');
  const [onlineUsers, setOnlineUsers] = useState([]);
  const [inVoiceChannel, setInVoiceChannel] = useState(false);
  const [voiceUsers, setVoiceUsers] = useState([]);
  const [pttActive, setPttActive] = useState(false); // PTT tuşuna basılı mı?
  const [userVolumes, setUserVolumes] = useState({});
  const [contextMenu, setContextMenu] = useState(null);
  const [showPeople, setShowPeople] = useState(false);
  const [chatReady, setChatReady] = useState(false);
  const [chatError, setChatError] = useState('');
  const [voiceJoining, setVoiceJoining] = useState(false);
  const [sending, setSending] = useState(false);
  const sendingRef = useRef(false);
  const sendAttemptRef = useRef(0);
  const [micMuted, setMicMuted] = useState(false);
  const [awayFromBottom, setAwayFromBottom] = useState(false);
  const micMutedRef = useRef(false);
  const ownSocketIdsRef = useRef(new Set());
  const volumeTriggerRef = useRef(null);
  const contextMenuRef = useRef(null);
  const composerRef = useRef(null);
  const voiceGenerationRef = useRef(0);
  const joiningRef = useRef(false);
  const remoteStreamsRef = useRef({});
  const volumesRef = useRef({});
  const usernameRef = useRef('');
  const messageListRef = useRef(null);
  const shouldScrollRef = useRef(true);
  const pendingMessageRef = useRef(null);

  const socketRef = useRef(null);
  const myStreamRef = useRef(null);
  const gainNodeRef = useRef(null);   // Canlı gain güncellemesi için
  const peersRef = useRef({});
  const audioRefs = useRef({});

  const getNickname = () => {
    try {
      const s = localStorage.getItem('xantum_settings');
      if (s) {
        const p = JSON.parse(s);
        if (p.nickname && p.nickname.trim().length > 0) return p.nickname;
      }
    } catch (e) {}
    return 'Player_' + Math.random().toString(36).substring(2, 6);
  };

  const [username, setUsername] = useState(getNickname);

  const getMasterVolume = () => {
    try {
      const s = JSON.parse(localStorage.getItem('xantum_settings'));
      if (s && Number.isFinite(s.masterVolume)) return Math.max(0, Math.min(100, s.masterVolume)) / 100;
    } catch (e) {}
    return 1;
  };

  const getSettings = () => {
    try {
      const settings = JSON.parse(localStorage.getItem('xantum_settings') || '{}');
      return settings && typeof settings === 'object' && !Array.isArray(settings) ? settings : {};
    } catch (e) {
      return {};
    }
  };

  const [voiceSettings, setVoiceSettings] = useState(getSettings);

  contextMenuRef.current = contextMenu;
  usernameRef.current = username;
  volumesRef.current = userVolumes;
  const volumeFor = id => Math.max(0, Math.min(1, ((volumesRef.current[id] ?? 100) / 100) * getMasterVolume()));
  const cleanupVoice = useCallback(() => {
    voiceGenerationRef.current += 1;
    joiningRef.current = false;
    const stream = myStreamRef.current;
    myStreamRef.current = null;
    stream?._rawStream?.getTracks().forEach(track => track.stop());
    stream?._cleanup?.();
    stream?.getTracks().forEach(track => track.stop());
    Object.values(peersRef.current).forEach(peer => peer.destroy());
    peersRef.current = {};
    remoteStreamsRef.current = {};
    gainNodeRef.current = null;
    setInVoiceChannel(false);
    setVoiceJoining(false);
    setPttActive(false);
    micMutedRef.current = false;
    setMicMuted(false);
    setContextMenu(null);
  }, []);

  useEffect(() => {
    if (shouldScrollRef.current && messageListRef.current) {
      messageListRef.current.scrollTop = messageListRef.current.scrollHeight;
    }
  }, [messages]);

  useEffect(() => {
    const list = messageListRef.current;
    if (!list) return;
    const observer = new ResizeObserver(() => {
      if (shouldScrollRef.current) list.scrollTop = list.scrollHeight;
    });
    observer.observe(list);
    return () => observer.disconnect();
  }, [connected]);

  // Ayarlar değişince canlı güncelle (gain, master volume)
  useEffect(() => {
    const onSettingsUpdate = (e) => {
      const s = { ...getSettings(), ...e.detail };
      setVoiceSettings(s);

      // Nickname güncelleme
      const newName = s.nickname && s.nickname.trim().length > 0 ? s.nickname.trim() : usernameRef.current;
      setUsername(newName);
      if (socketRef.current) {
        // update_profile: mevcut bağlantıda ismi güncelle
        socketRef.current.emit('update_profile', { username: newName });
      }

      // Master volume → tüm kullanıcıların audio elementlerini güncelle
      const master = (s.masterVolume !== undefined ? s.masterVolume : 100) / 100;
      Object.keys(audioRefs.current).forEach(id => {
        if (audioRefs.current[id]) {
          const userVol = userVolumes[id] !== undefined ? userVolumes[id] : 100;
          audioRefs.current[id].volume = Math.max(0, Math.min(1, (userVol / 100) * master));
        }
      });

      myStreamRef.current?.getAudioTracks().forEach(t => { t.enabled = !s.pttEnabled && !micMutedRef.current; });
      setPttActive(false);

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
    const onEscape = event => {
      if (event.key === 'Escape' && contextMenuRef.current) { setContextMenu(null); volumeTriggerRef.current?.focus(); }
    };

    window.addEventListener('xantum_settings_update', onSettingsUpdate);
    window.addEventListener('xantum_profile_update', onProfileUpdate);
    window.addEventListener('click', onClickClose);
    window.addEventListener('keydown', onEscape);

    return () => {
      window.removeEventListener('xantum_settings_update', onSettingsUpdate);
      window.removeEventListener('xantum_profile_update', onProfileUpdate);
      window.removeEventListener('click', onClickClose);
      window.removeEventListener('keydown', onEscape);
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
          myStreamRef.current.getAudioTracks().forEach(t => { t.enabled = !micMutedRef.current; });
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
    const releasePtt = () => {
      if (getSettings().pttEnabled) {
        myStreamRef.current?.getAudioTracks().forEach(t => { t.enabled = false; });
        setPttActive(false);
      }
    };
    const onVisibility = () => { if (document.hidden) releasePtt(); };
    window.addEventListener('blur', releasePtt);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('blur', releasePtt);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [inVoiceChannel]);

  useEffect(() => {
    if (!connected) return;
    let cancelled = false;
    let socket;
    setChatError('');
    const appendMessage = msg => setMessages(prev => prev.some(m => m.id === msg.id) ? prev : [...prev, msg].slice(-300));
    const start = async () => {
      const config = await window.electronAPI?.getChatConnection();
      if (cancelled) return;
      if (!config?.url || !config.pin) throw new Error(t("Sohbet bağlantı bilgileri bulunamadı. VPN’e yeniden bağlanın."));
      socket = io(config.url, { auth: { pin: config.pin }, transports: ['websocket'], timeout: 10000 });
      socketRef.current = socket;
      socket.on('connect', () => {
        ownSocketIdsRef.current.add(socket.id);
        setChatReady(true); setChatError('');
        socket.emit('join_network', { username: usernameRef.current });
      });
      socket.on('connect_error', () => { setChatReady(false); setChatError(t("Sohbete bağlanılamadı. Sunucu adresini ve katılım anahtarını kontrol edin.")); });
      socket.on('disconnect', () => {
        sendAttemptRef.current += 1; sendingRef.current = false;
        setChatReady(false); setSending(false); setOnlineUsers([]); setVoiceUsers([]); cleanupVoice();
        setChatError(t("Sohbet bağlantısı kesildi. Yeniden bağlanılıyor…"));
      });
      socket.on('online_users', setOnlineUsers);
      socket.on('voice_members', ids => setVoiceUsers(ids.filter(id => id !== socket.id)));
      socket.on('chat_message', appendMessage);
      const createPeer = (id, initiator) => {
        const peer = new Peer({ initiator, trickle: false, stream: myStreamRef.current,
          config: { iceServers: config.iceServers || [] } });
        peer.on('signal', sdp => socket.emit(initiator ? 'voice_offer' : 'voice_answer', { targetId: id, sdp }));
        peer.on('stream', stream => {
          remoteStreamsRef.current[id] = stream;
          const audio = audioRefs.current[id];
          if (audio) { audio.srcObject = stream; audio.volume = volumeFor(id); audio.play().catch(() => setChatError(t("Sesi başlatmak için ses odasına yeniden katılın."))); }
        });
        peer.on('error', () => setChatError(t("Bir ses bağlantısı kurulamadı. Sunucunun TURN yapılandırmasını kontrol edin.")));
        peer.on('close', () => {
          if (peersRef.current[id] === peer) { delete peersRef.current[id]; delete remoteStreamsRef.current[id]; }
        });
        peersRef.current[id] = peer;
        return peer;
      };
      socket.on('voice_channel_users', ids => {
        if (!myStreamRef.current) return;
        ids.forEach(id => { if (!peersRef.current[id]) createPeer(id, true); });
      });
      socket.on('voice_offer', ({ callerId, sdp }) => {
        if (!myStreamRef.current || peersRef.current[callerId]) return;
        try { createPeer(callerId, false).signal(sdp); } catch { setChatError(t("Ses bağlantısı kurulamadı.")); }
      });
      socket.on('voice_answer', ({ answererId, sdp }) => {
        try { peersRef.current[answererId]?.signal(sdp); } catch { setChatError(t("Ses bağlantısı kurulamadı.")); }
      });
      socket.on('user_left_voice', id => {
        peersRef.current[id]?.destroy(); delete peersRef.current[id]; delete remoteStreamsRef.current[id];
      });
    };
    start().catch(error => { if (!cancelled) setChatError(error.message); });
    return () => {
      cancelled = true; cleanupVoice(); socket?.disconnect(); socketRef.current = null;
      setChatReady(false); setOnlineUsers([]); setVoiceUsers([]); setMessages([]); setSending(false); pendingMessageRef.current = null;
      ownSocketIdsRef.current.clear(); shouldScrollRef.current = true; setAwayFromBottom(false);
      sendAttemptRef.current += 1; sendingRef.current = false;
    };
  }, [connected, cleanupVoice]);

  const joinVoice = async () => {
    if (!socketRef.current?.connected || joiningRef.current || myStreamRef.current) return;
    joiningRef.current = true;
    setVoiceJoining(true); setChatError('');
    const generation = voiceGenerationRef.current;
    try {
      const s = getSettings();

      const rawStream = await navigator.mediaDevices.getUserMedia({
        video: false,
        audio: {
          deviceId: s.micDeviceId && s.micDeviceId !== 'default' ? { exact: s.micDeviceId } : undefined,
          autoGainControl: false,
          echoCancellation: true,
          noiseSuppression: true,
        }
      });

      if (generation !== voiceGenerationRef.current || !socketRef.current?.connected) {
        rawStream.getTracks().forEach(t => t.stop()); return;
      }
      let finalStream = rawStream;
      let active = true;

      let audioCtx;
      try {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        if (audioCtx.state === 'suspended') await audioCtx.resume();
        if (generation !== voiceGenerationRef.current || !socketRef.current?.connected) {
          rawStream.getTracks().forEach(track => track.stop());
          await audioCtx.close(); return;
        }
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
        active = false;
        gainNodeRef.current = null;
        audioCtx?.close().catch(() => {});
        console.error(t("Audio pipeline hatası:"), e);
      }

      // İzin beklerken PTT ayarı değişmiş olabilir; güncel tercihi uygula.
      const currentSettings = getSettings();
      finalStream.getAudioTracks().forEach(track => {
        track.enabled = !currentSettings.pttEnabled && !micMutedRef.current;
      });

      myStreamRef.current = finalStream;
      const reply = await new Promise(resolve => {
        socketRef.current.timeout(5000).emit('join_voice_channel', {}, (error, result) => {
          resolve(error ? { error: t("Ses odasına katılım onaylanmadı. Yeniden deneyin.") } : result);
        });
      });
      if (generation !== voiceGenerationRef.current) return;
      if (!reply?.ok) {
        socketRef.current?.emit('leave_voice_channel'); cleanupVoice();
        setChatError(reply?.error || t("Ses odasına katılım onaylanmadı. Yeniden deneyin."));
        return;
      }
      setInVoiceChannel(true);
    } catch (err) {
      console.error(t("Mikrofon hatası:"), err);
      if (generation === voiceGenerationRef.current) {
        cleanupVoice(); setChatError(t("Mikrofona erişilemedi. Sistem izinlerini ve seçili mikrofonu kontrol edin."));
      }
    } finally {
      if (generation === voiceGenerationRef.current) { joiningRef.current = false; setVoiceJoining(false); }
    }
  };

  const leaveVoice = () => {
    socketRef.current?.emit('leave_voice_channel');
    cleanupVoice();
  };

  const handleVolumeChange = (userId, vol) => {
    setUserVolumes(prev => ({ ...prev, [userId]: vol }));
    if (audioRefs.current[userId]) {
      audioRefs.current[userId].volume = Math.max(0, Math.min(1, (vol / 100) * getMasterVolume()));
    }
  };

  const handleContextMenu = (e, userId) => {
    e.preventDefault();
    e.stopPropagation();
    volumeTriggerRef.current = e.currentTarget;
    const rect = e.currentTarget.getBoundingClientRect();
    setContextMenu({
      x: Math.max(8, Math.min(e.clientX || rect.left, window.innerWidth - 214)),
      y: Math.max(8, Math.min(e.clientY || rect.bottom + 6, window.innerHeight - 166)),
      userId
    });
  };

  const sendMessage = (e) => {
    e.preventDefault();
    if (!text.trim() || sendingRef.current || !socketRef.current?.connected) return;
    const draft = text;
    const msg = pendingMessageRef.current?.text === draft ? pendingMessageRef.current : { text: draft, clientId: crypto.randomUUID() };
    pendingMessageRef.current = msg;
    sendingRef.current = true;
    const attempt = ++sendAttemptRef.current;
    setSending(true); setChatError('');
    const socket = socketRef.current;
    socket.timeout(5000).emit('chat_message', msg, (error, reply) => {
      if (socketRef.current !== socket || attempt !== sendAttemptRef.current) return;
      sendingRef.current = false; setSending(false);
      if (error || !reply?.message) {
        setChatError(reply?.error || t("Teslim onayı alınamadı. Taslağın korundu; yeniden gönderebilirsin.")); return;
      }
      shouldScrollRef.current = true; setAwayFromBottom(false);
      setMessages(prev => prev.some(m => m.id === reply.message.id) ? prev : [...prev, reply.message].slice(-300));
      setText(current => current === draft ? '' : current);
      pendingMessageRef.current = null;
      composerRef.current?.focus();
    });
  };

  const toggleMic = () => {
    const muted = !micMutedRef.current;
    micMutedRef.current = muted;
    setMicMuted(muted);
    myStreamRef.current?.getAudioTracks().forEach(track => {
      track.enabled = !muted && (!getSettings().pttEnabled || pttActive);
    });
  };

  const scrollToLatest = () => {
    shouldScrollRef.current = true;
    setAwayFromBottom(false);
    if (messageListRef.current) messageListRef.current.scrollTop = messageListRef.current.scrollHeight;
  };

  if (!connected) {
    return (
      <section className="chat-offline" aria-labelledby="chat-offline-title">
        <div className="chat-offline-symbol"><i className="fas fa-comments" aria-hidden="true" /></div>
        <h2 id="chat-offline-title">{t("Buluşma yeriniz, burada.")}</h2>
        <p>{t("Aynı sunucudaki kişilerle mesajlaş,")}<br />{t("bir ses odasında birlikte vakit geçir.")}</p>
        <div className="chat-offline-note"><i className="fas fa-plug" aria-hidden="true" /><span>{t("Başlamak için Ana Sayfa’dan VPN’e bağlan.")}</span></div>
      </section>
    );
  }

  const pttEnabled = voiceSettings.pttEnabled;
  const pttKey = voiceSettings.pttKey || 'CapsLock';
  const voiceCount = voiceUsers.length + (inVoiceChannel ? 1 : 0);
  const volumeUser = onlineUsers.find(user => user.id === contextMenu?.userId);
  const currentVolume = contextMenu ? (userVolumes[contextMenu.userId] ?? 100) : 100;

  return (
    <div className="chat-layout">
      {contextMenu && (
        <div className="chat-volume-popover" role="dialog" aria-label={t('{name} ses ayarı', { name: volumeUser?.username || t('Oyuncu') })}
          onClick={e => e.stopPropagation()} style={{ top: contextMenu.y, left: contextMenu.x }}>
          <div className="chat-volume-heading"><strong title={volumeUser?.username}>{volumeUser?.username || t("Oyuncu")}</strong>
            <button type="button" className="chat-icon-button" aria-label={t("Ses ayarını kapat")} onClick={() => { setContextMenu(null); volumeTriggerRef.current?.focus(); }}><i className="fas fa-xmark" aria-hidden="true" /></button>
          </div>
          <label htmlFor="chat-user-volume">{t("Ses seviyesi ")}<output>{currentVolume}%</output></label>
          <input autoFocus id="chat-user-volume" aria-label={t("Kullanıcı ses seviyesi")} type="range" min="0" max="100" value={currentVolume}
            onChange={e => handleVolumeChange(contextMenu.userId, Number(e.target.value))} />
          <button type="button" className="chat-volume-toggle" onClick={() => handleVolumeChange(contextMenu.userId, currentVolume === 0 ? 100 : 0)}>
            <i className={`fas ${currentVolume === 0 ? 'fa-volume-high' : 'fa-volume-xmark'}`} aria-hidden="true" /> {currentVolume === 0 ? t("Sesi aç") : t("Bu kişiyi sustur")}
          </button>
        </div>
      )}

      {voiceUsers.map(userId => (
        <audio key={userId} ref={el => {
          if (el) {
            audioRefs.current[userId] = el;
            el.volume = volumeFor(userId);
            if (remoteStreamsRef.current[userId]) el.srcObject = remoteStreamsRef.current[userId];
          } else { delete audioRefs.current[userId]; }
        }} autoPlay />
      ))}

      <header className="chat-room-header">
        <div className="chat-room-heading">
          <span className="chat-room-mark"><i className="fas fa-comment-dots" aria-hidden="true" /></span>
          <div><h2>{t("Ağ sohbeti")}</h2><p className={`chat-connection ${chatReady ? 'is-online' : ''}`} role="status"><span aria-hidden="true" />{chatReady ? t("Aynı ağ, ortak sohbet.") : t("Sohbete bağlanıyor…")}</p></div>
        </div>
        <button type="button" className={`chat-presence-button ${showPeople ? 'is-open' : ''}`} aria-expanded={showPeople} aria-controls="chat-people" aria-label={t('Ağdaki kişiler: {count}', { count: onlineUsers.length })} onClick={() => setShowPeople(value => !value)}>
          <span className="chat-avatar-stack" aria-hidden="true">{onlineUsers.slice(0, 3).map((user, index) => <span key={user.id} className={`chat-avatar tone-${index % 3}`}>{initials(user.username)}</span>)}</span>
          <span>{onlineUsers.length}<span className="chat-presence-label">{t(" kişi", { count: onlineUsers.length })}</span></span><i className={`fas ${showPeople ? 'fa-chevron-up' : 'fa-chevron-down'}`} aria-hidden="true" />
        </button>
      </header>

      {showPeople && <section id="chat-people" className="chat-presence-panel" aria-label={t("Ağdaki kişiler")}>
        {onlineUsers.length ? <ul>{onlineUsers.map((user, index) => <li key={user.id}>
          <span className={`chat-avatar tone-${index % 3}`} aria-hidden="true">{initials(user.username)}</span>
          <span className="chat-person-info"><strong title={user.username}>{user.username}{user.id === socketRef.current?.id && <small>{t("sen")}</small>}</strong><span>{user.id === socketRef.current?.id && inVoiceChannel || voiceUsers.includes(user.id) ? t("Ses odasında") : t("Çevrimiçi")}</span></span>
          <span className="chat-online-dot" aria-hidden="true" />
        </li>)}</ul> : <p>{t("Ağdaki kişiler bekleniyor…")}</p>}
      </section>}

      {chatError && <div className="chat-error" role="alert"><i className="fas fa-circle-exclamation" aria-hidden="true" /><p>{t(chatError)}</p>
        {!chatReady && <button type="button" onClick={() => { setChatError(''); socketRef.current?.connect(); }}>{t("Yeniden dene")}</button>}
      </div>}
      <section className="chat-message-area" aria-label={t("Ağ sohbeti")}>
        <div className="chat-messages" role="log" aria-label={t("Mesajlar")} aria-live="polite" aria-relevant="additions" ref={messageListRef}
          onScroll={e => { const el = e.currentTarget; const away = el.scrollHeight - el.scrollTop - el.clientHeight >= 80; shouldScrollRef.current = !away; setAwayFromBottom(away); }}>
          {!messages.length ? <div className="chat-empty"><div className="chat-empty-symbol"><i className="fas fa-hand-peace" aria-hidden="true" /></div><h3>{t("Bir merhaba ile başlar.")}</h3><p>{t("Ekibine mesaj gönder.")}<br />{t("Sohbet buradan devam etsin.")}</p><span>{t("Mesajlar bu oturumda tutulur.")}</span></div> : <div className="chat-session-divider"><span>{t("Bu oturum")}</span></div>}
          {messages.map((message, index) => {
            const mine = ownSocketIdsRef.current.has(message.senderId);
            const previous = messages[index - 1];
            const next = messages[index + 1];
            const lastInGroup = next?.senderId !== message.senderId || next.time - message.time >= 120000;
            const grouped = previous?.senderId === message.senderId && message.time - previous.time < 120000;
            const time = messageTime(message.time);
            return <article key={message.id} className={`chat-message ${mine ? 'is-mine' : ''} ${grouped ? 'is-grouped' : ''}`} aria-label={`${message.sender}: ${message.text}`}>
              {!mine && <span className="chat-message-avatar" aria-hidden="true">{grouped ? '' : initials(message.sender)}</span>}
              <div className="chat-message-content">
                {!grouped && <div className="chat-message-meta"><strong title={message.sender}>{mine ? t("Sen") : message.sender}</strong>{time && <time dateTime={time.toISOString()}>{time.toLocaleTimeString(numberLocale, { hour: '2-digit', minute: '2-digit' })}</time>}</div>}
                <p dir="auto">{message.text}</p>
                {mine && lastInGroup && <span className="chat-message-delivery"><i className="fas fa-check-double" aria-hidden="true" />{t(" Sunucuya iletildi")}</span>}
              </div>
            </article>;
          })}
        </div>
        {awayFromBottom && <button type="button" className="chat-jump-button" onClick={scrollToLatest}><i className="fas fa-arrow-down" aria-hidden="true" />{t(" Son mesajlar")}</button>}
      </section>

      <aside className={`chat-voice-dock ${inVoiceChannel ? 'is-joined' : ''}`} aria-label={t("Ses odası")}>
        <div className="chat-voice-identity"><span className="chat-voice-symbol"><i className="fas fa-headphones" aria-hidden="true" /></span><div><strong>{t("Ses odası ")}<span>{voiceCount}/8</span></strong><p>{inVoiceChannel ? t("Odaya bağlısın") : voiceCount ? t('{count} kişi konuşuyor', { count: voiceCount }) : t("Birlikte konuşalım")}</p></div></div>
        <ul className="chat-voice-members" aria-label={t("Odadaki kişiler")}>
          {inVoiceChannel && <li className={`chat-voice-self ${!micMuted && (!pttEnabled || pttActive) ? 'is-speaking' : ''}`} title={t('{name} · sen', { name: username })}>
            <span className="chat-avatar" aria-hidden="true">{initials(username)}</span><span className="chat-voice-person-name">{username}<small>{t("sen")}</small></span>
            <i className={`fas ${micMuted || (pttEnabled && !pttActive) ? 'fa-microphone-slash' : 'fa-microphone'}`} aria-label={micMuted ? t("Mikrofon kapalı") : pttEnabled && !pttActive ? t("Bas konuş bekliyor") : t("Mikrofon açık")} />
          </li>}
          {voiceUsers.map(userId => {
            const user = onlineUsers.find(item => item.id === userId);
            const muted = userVolumes[userId] === 0;
            return <li key={userId}><button type="button" className={`chat-voice-person ${muted ? 'is-muted' : ''}`} aria-label={t('{name} ses seviyesini ayarla', { name: user?.username || t('Oyuncu') })}
              aria-haspopup="dialog" aria-expanded={contextMenu?.userId === userId} title={t('{name} · ses ayarı', { name: user?.username || t('Oyuncu') })} onClick={e => handleContextMenu(e, userId)} onContextMenu={e => handleContextMenu(e, userId)}>
              <span className="chat-avatar" aria-hidden="true">{initials(user?.username)}</span><span className="chat-voice-person-name">{user?.username || t("Oyuncu")}</span><i className={`fas ${muted ? 'fa-volume-xmark' : 'fa-volume-low'}`} aria-hidden="true" />
            </button></li>;
          })}
        </ul>
        {!inVoiceChannel ? <button type="button" className="chat-join-button" disabled={!chatReady || voiceJoining} onClick={joinVoice}>
          <i className={`fas ${voiceJoining ? 'fa-circle-notch fa-spin' : 'fa-plus'}`} aria-hidden="true" />{voiceJoining ? t("Katılıyor…") : t("Sese katıl")}
        </button> : <div className="chat-voice-actions">
          <button type="button" className={`chat-mic-button ${micMuted ? 'is-muted' : ''}`} onClick={toggleMic} aria-pressed={micMuted} aria-label={micMuted ? t("Mikrofonu aç") : t("Mikrofonu kapat")} title={micMuted ? t("Mikrofonu aç") : t("Mikrofonu kapat")}><i className={`fas ${micMuted ? 'fa-microphone-slash' : 'fa-microphone'}`} aria-hidden="true" /></button>
          <button type="button" className="chat-leave-button" onClick={leaveVoice} aria-label={t("Ses odasından ayrıl")} title={t("Ses odasından ayrıl")}><i className="fas fa-phone-slash" aria-hidden="true" /><span>{t("Ayrıl")}</span></button>
        </div>}
        {inVoiceChannel && <div className={`${!pttEnabled ? 'sr-only' : 'chat-mic-status'} ${pttActive && !micMuted ? 'is-active' : ''}`} role="status">
          {micMuted ? t("Mikrofonun kapalı") : pttEnabled ? <>{pttActive ? t("Sesin iletiliyor") : t("Basılı tut, konuş")} <kbd>{pttKey}</kbd></> : t("Mikrofonun açık")}
        </div>}
      </aside>

      <div className="chat-compose-area">
        <form onSubmit={sendMessage} className="chat-composer">
          <label className="sr-only" htmlFor="chat-message">{t("Mesajın")}</label>
          <textarea id="chat-message" ref={composerRef} rows="2" value={text} maxLength={2000} onChange={e => setText(e.target.value)}
            aria-describedby="chat-composer-hint" placeholder={chatReady ? t("Sohbete bir mesaj bırak…") : t("Bağlantı bekleniyor…")}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); if (!e.repeat) sendMessage(e); } }} />
          <button type="submit" disabled={!chatReady || sending || !text.trim()} aria-label={sending ? t("Mesaj gönderiliyor") : t("Mesajı gönder")} title={sending ? t("Gönderiliyor…") : t("Gönder")}><i className={`fas ${sending ? 'fa-circle-notch fa-spin' : 'fa-arrow-up'}`} aria-hidden="true" /></button>
        </form>
        <div className="chat-composer-hint" id="chat-composer-hint"><span><kbd>Enter</kbd>{t(" gönder ")}<span>·</span> <kbd>Shift + Enter</kbd>{t(" yeni satır")}</span><span className={text.length > 1800 ? 'is-near-limit' : ''}>{text.length.toLocaleString(numberLocale)} / {(2000).toLocaleString(numberLocale)}</span></div>
      </div>
    </div>
  );
}
