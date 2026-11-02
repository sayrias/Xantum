'use strict'

// Compatibility for the old IPC entry. Server installation now uses the reviewed
// TLS-aware scripts/setup-server.sh flow; a connection echo is not a deployment.
async function setupServerViaSSH() {
  return { success: false, error: 'Sunucu kurulumu için docs/KURULUM.md içindeki TLS ve SSH adımlarını kullanın.' }
}
module.exports = { setupServerViaSSH }
