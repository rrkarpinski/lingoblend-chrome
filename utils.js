// Format required for server-side validation: exactly 16 lowercase hex characters [0-9a-f], no separators —
// the hex encoding of 8 cryptographically random bytes.
export function generateProfileId() {
  return [...crypto.getRandomValues(new Uint8Array(8))]
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}

export function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[ch]));
}
