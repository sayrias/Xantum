import React, { useState, useEffect } from 'react';

export default function FatalErrorModal() {
  const [error, setError] = useState(null); // { message, stack, logDir }
  const [logPath, setLogPath] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    // Log klasörü yolunu al
    if (window.electronAPI?.getLogPath) {
      window.electronAPI.getLogPath().then(p => setLogPath(p)).catch(() => {});
    }

    // Main process'ten gelen fatal hata olayını dinle
    if (window.electronAPI?.onFatalError) {
      return window.electronAPI.onFatalError((data) => {
        setError(data);
        if (data.logDir) setLogPath(data.logDir);
      });
    }
  }, []);

  const openLogDir = () => {
    if (window.electronAPI?.openLogDir) {
      window.electronAPI.openLogDir();
    }
  };

  const copyError = () => {
    if (error) {
      navigator.clipboard.writeText(error.stack || error.message).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      });
    }
  };

  if (!error) return null;

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 99999,
      background: 'rgba(0,0,0,0.75)',
      backdropFilter: 'blur(8px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '20px'
    }}>
      <div style={{
        background: 'linear-gradient(135deg, #1a0a0a 0%, #1a1a2e 100%)',
        border: '1px solid rgba(255,71,87,0.4)',
        borderRadius: '16px',
        padding: '28px',
        maxWidth: '520px',
        width: '100%',
        boxShadow: '0 20px 60px rgba(255,71,87,0.2)',
      }}>
        {/* Başlık */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '20px' }}>
          <div style={{
            width: '42px', height: '42px', borderRadius: '50%',
            background: 'rgba(255,71,87,0.15)',
            border: '1px solid rgba(255,71,87,0.4)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0
          }}>
            <i className="fas fa-exclamation-triangle" style={{ color: '#ff4757', fontSize: '18px' }}></i>
          </div>
          <div>
            <h2 style={{ margin: 0, fontSize: '16px', color: '#ff4757' }}>Beklenmedik Hata</h2>
            <p style={{ margin: '2px 0 0 0', fontSize: '11px', color: 'var(--text-muted)' }}>
              Uygulamada kritik bir hata oluştu
            </p>
          </div>
        </div>

        {/* Hata Mesajı */}
        <div style={{
          background: 'rgba(0,0,0,0.4)',
          border: '1px solid rgba(255,71,87,0.2)',
          borderRadius: '8px',
          padding: '12px',
          marginBottom: '16px',
          maxHeight: '120px',
          overflowY: 'auto'
        }}>
          <code style={{ fontSize: '11px', color: '#ff6b7a', fontFamily: 'monospace', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
            {error.message}
          </code>
        </div>

        {/* Log Konumu */}
        <div style={{
          background: 'rgba(255,255,255,0.03)',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: '8px',
          padding: '10px 14px',
          marginBottom: '20px'
        }}>
          <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginBottom: '4px' }}>
            <i className="fas fa-folder" style={{ marginRight: '5px' }}></i>
            Hata Günlüğü Konumu
          </div>
          <code style={{
            fontSize: '11px', color: '#00d4aa', fontFamily: 'monospace',
            wordBreak: 'break-all', display: 'block'
          }}>
            {logPath || 'Hesaplanıyor...'}
          </code>
        </div>

        {/* Butonlar */}
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          <button
            onClick={openLogDir}
            style={{
              flex: 1, padding: '10px 16px',
              background: 'linear-gradient(135deg, #8b5cf6, #6d28d9)',
              border: 'none', borderRadius: '8px', color: 'white',
              fontWeight: 'bold', fontSize: '12px', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px'
            }}
          >
            <i className="fas fa-folder-open"></i>
            Log Klasörünü Aç
          </button>

          <button
            onClick={copyError}
            style={{
              flex: 1, padding: '10px 16px',
              background: copied ? 'rgba(0,212,170,0.15)' : 'rgba(255,255,255,0.05)',
              border: `1px solid ${copied ? '#00d4aa' : 'rgba(255,255,255,0.1)'}`,
              borderRadius: '8px',
              color: copied ? '#00d4aa' : 'var(--text-secondary)',
              fontWeight: 'bold', fontSize: '12px', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
              transition: 'all 0.2s'
            }}
          >
            <i className={`fas ${copied ? 'fa-check' : 'fa-copy'}`}></i>
            {copied ? 'Kopyalandı!' : 'Hatayı Kopyala'}
          </button>

          <button
            onClick={() => setError(null)}
            style={{
              padding: '10px 20px',
              background: 'rgba(255,71,87,0.1)',
              border: '1px solid rgba(255,71,87,0.3)',
              borderRadius: '8px', color: '#ff4757',
              fontWeight: 'bold', fontSize: '12px', cursor: 'pointer',
            }}
          >
            Kapat
          </button>
        </div>

        <p style={{ margin: '14px 0 0 0', fontSize: '10px', color: 'var(--text-muted)', textAlign: 'center' }}>
          Bu hatayı geliştirici ile paylaşmak için "Hatayı Kopyala" butonunu kullanabilirsiniz.
        </p>
      </div>
    </div>
  );
}
