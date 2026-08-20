const { NodeSSH } = require('node-ssh')

async function setupServerViaSSH({ host, username, password }) {
  const ssh = new NodeSSH()
  
  try {
    // 1. Sunucuya bağlan
    await ssh.connect({
      host,
      username,
      password,
      readyTimeout: 15000
    })

    // 2. Setup scriptini indir ve çalıştır
    const setupScriptUrl = 'https://raw.githubusercontent.com/eren/xantum/main/server/setup.sh' // Varsayımsal URL, daha sonra GitHub linkiyle değiştirilmeli
    // Şu anlık scripti bilgisayardan okuyup sunucuya yükleyeceğiz.
    
    // Geliştirme aşamasında lokalden okumak için (Production'da github'dan curl ile indirilmeli)
    // Ancak bu modül şimdilik temel SSH testini yapacak
    const result = await ssh.execCommand('echo "SSH Bağlantısı Başarılı!"')
    
    return { success: true, message: result.stdout }
  } catch (error) {
    console.error("SSH Hatası:", error)
    return { success: false, error: error.message }
  } finally {
    ssh.dispose()
  }
}

module.exports = {
  setupServerViaSSH
}
