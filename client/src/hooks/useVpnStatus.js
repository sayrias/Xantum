import { useState, useEffect, useCallback, useRef } from 'react'

const API = window.electronAPI?.vpn

export function useVpnStatus() {
  const [status, setStatus] = useState({
    connected: false,
    connecting: false,
    interface: null,
    error: null,
  })
  
  const [publicIp, setPublicIp] = useState(null)
  const [prevIp, setPrevIp] = useState(null)
  const statusInterval = useRef(null)

  // İlk IP'yi kaydet
  useEffect(() => {
    const fetchInitialIp = async () => {
      const ip = await API?.getPublicIp()
      if (ip) {
        setPublicIp(ip)
        setPrevIp(ip)
      }
    }
    fetchInitialIp()
  }, [])

  // Düzenli durum kontrolü
  useEffect(() => {
    const checkStatus = async () => {
      try {
        const result = await API?.status()
        if (result) {
          setStatus(prev => ({
            ...prev,
            connected: result.connected,
            interface: result.interface,
            error: result.error || null,
          }))
        }
      } catch (e) {
        // API henüz hazır değil
      }
    }
    
    checkStatus()
    statusInterval.current = setInterval(checkStatus, 3000)
    return () => clearInterval(statusInterval.current)
  }, [])

  // VPN bağlantısı değişince IP güncelle
  useEffect(() => {
    if (status.connected) {
      // Kısa gecikmeyle yeni IP'yi al (tünel kurulana kadar bekle)
      const timer = setTimeout(async () => {
        const newIp = await API?.getPublicIp()
        if (newIp) setPublicIp(newIp)
      }, 2000)
      return () => clearTimeout(timer)
    }
  }, [status.connected])

  const connect = useCallback(async (configPath) => {
    setStatus(prev => ({ ...prev, connecting: true, error: null }))
    
    // Mevcut IP'yi kaydet
    const currentIp = await API?.getPublicIp()
    if (currentIp) setPrevIp(currentIp)
    
    try {
      const result = await API?.connect(configPath)
      if (result?.success) {
        setStatus(prev => ({
          ...prev,
          connected: true,
          connecting: false,
          interface: result.interface,
        }))
        
        // Yeni IP al
        setTimeout(async () => {
          const newIp = await API?.getPublicIp()
          if (newIp) setPublicIp(newIp)
        }, 2500)
      } else {
        setStatus(prev => ({
          ...prev,
          connecting: false,
          error: result?.error || 'Bağlantı kurulamadı',
        }))
      }
    } catch (e) {
      setStatus(prev => ({
        ...prev,
        connecting: false,
        error: e.message || 'Beklenmeyen hata',
      }))
    }
  }, [])

  const disconnect = useCallback(async () => {
    setStatus(prev => ({ ...prev, connecting: true, error: null }))
    
    try {
      const result = await API?.disconnect(status.interface)
      if (result?.success) {
        setStatus(prev => ({
          ...prev,
          connected: false,
          connecting: false,
          interface: null,
        }))
        
        // Gerçek IP'ye geri dön
        setTimeout(async () => {
          const newIp = await API?.getPublicIp()
          if (newIp) setPublicIp(newIp)
        }, 1500)
      } else {
        setStatus(prev => ({
          ...prev,
          connecting: false,
          error: result?.error || 'Bağlantı kesilemedi',
        }))
      }
    } catch (e) {
      setStatus(prev => ({
        ...prev,
        connecting: false,
        error: e.message,
      }))
    }
  }, [status.interface])

  return { status, publicIp, prevIp, connect, disconnect }
}
