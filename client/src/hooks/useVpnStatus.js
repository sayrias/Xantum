import { useState, useEffect, useCallback, useRef } from 'react'

const API = window.electronAPI?.vpn

export function useVpnStatus() {
  const [status, setStatus] = useState({
    connected: false,
    ready: false,
    connecting: false,
    interface: null,
    error: null,
    protection: { state: 'unknown', active: false, blocked: false, verified: false, error: null },
  })

  /* ipInfo: { ip, country, countryCode, city, isp, flag } */
  const [ipInfo,  setIpInfo]  = useState(null)
  const [prevIp,  setPrevIp]  = useState(null)
  const statusInterval = useRef(null)
  const ipRequest = useRef(0)

  /* ---- IP bilgisini çek (geo dahil) ---- */
  const refreshIpInfo = useCallback(async () => {
    const request = ++ipRequest.current
    try {
      const info = await API?.getIpInfo?.()
      if (request === ipRequest.current && info?.ip) setIpInfo(info)
    } catch {}
  }, [])

  useEffect(() => window.electronAPI?.onVpnDisconnected?.(() => {
    setStatus(prev => ({ ...prev, connected: false, connecting: false, interface: null, error: 'VPN bağlantısı kesildi.' }))
  }), [])


  useEffect(() => window.electronAPI?.onProtectionChange?.(protection => {
    setStatus(prev => ({ ...prev, protection }))
  }), [])

  /* Düzenli durum kontrolü (3 sn) */
  useEffect(() => {
    const checkStatus = async () => {
      try {
        const result = await API?.status()
        if (result) {
          setStatus(prev => ({
            ...prev,
            connected: result.connected,
            ready: true,
            interface: result.interface,
            protection: result.protection || { state: 'inactive', active: false, blocked: false, verified: false, error: null },
            error: result.error || null,
          }))
        }
      } catch {}
    }

    checkStatus()
    statusInterval.current = setInterval(checkStatus, 3000)
    return () => clearInterval(statusInterval.current)
  }, [])

  /* One refresh per transition; discard late results from the previous network. */
  useEffect(() => {
    ipRequest.current++
    setIpInfo(null)
    if (!status.ready || status.protection?.state === 'unknown' || status.protection?.blocked || (status.protection?.active && !status.connected)) return
    const timer = setTimeout(refreshIpInfo, status.connected ? 3000 : 0)
    return () => { clearTimeout(timer); ipRequest.current++ }
  }, [status.ready, status.connected, status.protection?.state, status.protection?.active, status.protection?.blocked, refreshIpInfo])

  /* ---- Bağlan ---- */
  const connect = useCallback(async (configPath) => {
    setStatus(prev => ({ ...prev, connecting: true, error: null }))

    try {
      const currentIp = ipInfo?.ip
      if (currentIp) setPrevIp(currentIp)
      const result = await API?.connect(configPath)
      if (result?.success) {
        setStatus(prev => ({
          ...prev,
          connected: true,
          connecting: false,
          interface: result.interface,
        }))


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
  }, [ipInfo, refreshIpInfo])

  /* ---- Bağlantıyı Kes ---- */
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
  }, [status.interface, refreshIpInfo])

  const checkProtection = useCallback(async () => {
    const protection = await API?.checkProtection?.()
    if (protection) setStatus(prev => ({ ...prev, protection }))
    return protection
  }, [])
  const releaseProtection = useCallback(async () => {
    const result = await API?.releaseProtection?.()
    if (result?.protection) setStatus(prev => ({ ...prev, protection: result.protection }))
    return result
  }, [])
  const installHelpers = useCallback(async () => {
    const result = await API?.installHelpers?.()
    if (result?.protection) setStatus(prev => ({ ...prev, protection: result.protection, error: null }))
    return result || { success: false, error: 'Koruma kurulumu Xantum masaüstü uygulamasında yapılabilir.' }
  }, [])

  /* publicIp: geriye dönük uyumluluk için sadece IP string'i */
  const publicIp = ipInfo?.ip || null

  return { status, publicIp, ipInfo, prevIp, connect, disconnect, checkProtection, releaseProtection, installHelpers }
}
