import React from 'react'
import { AreaChart, Area, Tooltip, ResponsiveContainer } from 'recharts'
import { formatBytes, formatSpeed } from '../hooks/useNetworkStats'

/**
 * İstatistikler Paneli
 * - Upload/Download hızı
 * - Toplam transfer
 * - Mini hız grafiği (Recharts)
 */
export default function StatsPanel({ stats, connected }) {
  const { rxTotal, txTotal, rxSpeed, txSpeed, history } = stats
  
  const rxFormatted = formatBytes(rxTotal)
  const txFormatted = formatBytes(txTotal)
  const rxSpeedFmt  = formatSpeed(rxSpeed)
  const txSpeedFmt  = formatSpeed(txSpeed)


  return (
    <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: '12px', opacity: connected ? 1 : 0.5, pointerEvents: connected ? 'auto' : 'none' }}>
      <span className="section-title"><i className="fas fa-chart-bar" style={{ marginRight: '6px' }}></i> Canlı İstatistikler</span>
      
      {/* Hız kartları */}
      <div className="stats-grid">
        {/* Download */}
        <div className="stat-item">
          <div className="stat-icon-label">
            <span className="stat-arrow-down"><i className="fas fa-arrow-down"></i></span>
            <span>İndirme</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '4px' }}>
            <span id="rx-speed" className="stat-value">{rxSpeedFmt.value}</span>
            <span className="stat-unit">{rxSpeedFmt.unit}</span>
          </div>
          <div style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
            Toplam: {rxFormatted.value} {rxFormatted.unit}
          </div>
        </div>
        
        {/* Upload */}
        <div className="stat-item">
          <div className="stat-icon-label">
            <span className="stat-arrow-up"><i className="fas fa-arrow-up"></i></span>
            <span>Yükleme</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '4px' }}>
            <span id="tx-speed" className="stat-value">{txSpeedFmt.value}</span>
            <span className="stat-unit">{txSpeedFmt.unit}</span>
          </div>
          <div style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
            Toplam: {txFormatted.value} {txFormatted.unit}
          </div>
        </div>
      </div>

      {/* Mini hız grafiği */}
      {history.length > 2 && (
        <div style={{ height: '60px', marginTop: '-4px' }}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={history} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="rxGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#6C63FF" stopOpacity={0.4} />
                  <stop offset="95%" stopColor="#6C63FF" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="txGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#00d4aa" stopOpacity={0.4} />
                  <stop offset="95%" stopColor="#00d4aa" stopOpacity={0} />
                </linearGradient>
              </defs>
              <Tooltip
                contentStyle={{
                  background: 'rgba(13, 21, 38, 0.95)',
                  border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: '8px',
                  fontSize: '11px',
                  color: '#f0f4ff',
                }}
                formatter={(value, name) => {
                  const speed = formatSpeed(value)
                  return [`${speed.value} ${speed.unit}`, name === 'rx' ? '↓ İndirme' : '↑ Yükleme']
                }}
                labelFormatter={() => ''}
              />
              <Area
                type="monotone"
                dataKey="rx"
                stroke="#6C63FF"
                strokeWidth={1.5}
                fill="url(#rxGrad)"
                dot={false}
                isAnimationActive={false}
              />
              <Area
                type="monotone"
                dataKey="tx"
                stroke="#00d4aa"
                strokeWidth={1.5}
                fill="url(#txGrad)"
                dot={false}
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}
