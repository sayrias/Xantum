import { useState, useEffect, useRef } from 'react'

const API = window.electronAPI

/**
 * Baytları okunabilir formata çevir
 */
export function formatBytes(bytes) {
  if (!bytes || bytes === 0) return { value: '0', unit: 'B' }
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  const value = (bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0)
  return { value, unit: units[i] }
}

/**
 * Hızı hesapla (bytes/saniye → KB/s, MB/s)
 */
export function formatSpeed(bytesPerSec) {
  if (!bytesPerSec || bytesPerSec <= 0) return { value: '0', unit: 'KB/s' }
  if (bytesPerSec < 1024) return { value: bytesPerSec.toFixed(0), unit: 'B/s' }
  if (bytesPerSec < 1024 * 1024) return { value: (bytesPerSec / 1024).toFixed(1), unit: 'KB/s' }
  return { value: (bytesPerSec / (1024 * 1024)).toFixed(2), unit: 'MB/s' }
}

/**
 * Süreyi formatlı göster (HH:MM:SS)
 */
export function formatUptime(ms) {
  if (!ms) return '00:00:00'
  const totalSeconds = Math.floor(ms / 1000)
  const hours   = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  return [hours, minutes, seconds]
    .map(v => String(v).padStart(2, '0'))
    .join(':')
}

export function useNetworkStats(connected, interfaceName) {
  const [stats, setStats] = useState({
    rxTotal: 0,
    txTotal: 0,
    rxSpeed: 0,
    txSpeed: 0,
    uptime: 0,
    history: [], // Son 30 saniyenin hız verileri (grafik için)
  })
  
  const prevStats = useRef(null)
  const prevTime = useRef(null)
  const interval = useRef(null)
  const uptimeInterval = useRef(null)
  const connectedTime = useRef(null)

  useEffect(() => {
    if (!connected) {
      // Bağlantı kesildi — sıfırla
      setStats({
        rxTotal: 0, txTotal: 0,
        rxSpeed: 0, txSpeed: 0,
        uptime: 0, history: [],
      })
      prevStats.current = null
      prevTime.current = null
      connectedTime.current = null
      clearInterval(interval.current)
      clearInterval(uptimeInterval.current)
      return
    }

    // Bağlandı
    connectedTime.current = Date.now()
    
    // Uptime sayacı
    uptimeInterval.current = setInterval(() => {
      const elapsed = Date.now() - (connectedTime.current || Date.now())
      setStats(prev => ({ ...prev, uptime: elapsed }))
    }, 1000)

    // Transfer istatistikleri
    const fetchStats = async () => {
      try {
        const result = await API?.vpn.stats(interfaceName)
        if (!result?.stats) return
        
        const now = Date.now()
        const { rx, tx } = result.stats
        
        let rxSpeed = 0, txSpeed = 0
        
        if (prevStats.current && prevTime.current) {
          const dt = (now - prevTime.current) / 1000 // saniye
          rxSpeed = Math.max(0, (rx - prevStats.current.rx) / dt)
          txSpeed = Math.max(0, (tx - prevStats.current.tx) / dt)
        }
        
        prevStats.current = { rx, tx }
        prevTime.current = now
        
        setStats(prev => ({
          ...prev,
          rxTotal: rx,
          txTotal: tx,
          rxSpeed,
          txSpeed,
          history: [
            ...prev.history.slice(-29),
            { time: now, rx: rxSpeed, tx: txSpeed }
          ],
        }))
      } catch (e) {
        // Stats alınamadı
      }
    }
    
    fetchStats()
    interval.current = setInterval(fetchStats, 1000)
    
    return () => {
      clearInterval(interval.current)
      clearInterval(uptimeInterval.current)
    }
  }, [connected, interfaceName])

  return stats
}
