const _lidToPhone = {};

function upsertContacts(contacts) {
  for (const c of contacts) {
    if (c.lid && c.id && c.id.includes('@s.whatsapp.net')) {
      _lidToPhone[c.lid] = c.id;
    }
  }
}

// Returns the real @s.whatsapp.net JID if known, otherwise returns the original JID
function resolveJid(jid) {
  if (!jid) return jid;
  return _lidToPhone[jid] || jid;
}

module.exports = { upsertContacts, resolveJid };
