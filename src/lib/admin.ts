// Server administration logic shared by every client. "Admin" here means the ABS
// account type on one server, which is what the server itself enforces. It is
// not the control-plane link role and not a platform admin.

/** True for ABS account types that may use the server admin area. */
export function isAdminAccountType(type: string | null | undefined): boolean {
  return type === 'admin' || type === 'root'
}

/** A file or library size for display: "812 KB", "42 MB", "1.3 GB". */
export function fmtBytes(bytes: number): string {
  const mb = bytes / (1024 * 1024)
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`
  if (mb >= 1) return `${mb.toFixed(0)} MB`
  return `${Math.max(1, Math.round(bytes / 1024))} KB`
}

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

function utf8Bytes(value: string): number[] {
  const bytes: number[] = []
  for (const char of value) {
    let code = char.codePointAt(0) ?? 0xfffd
    if (code >= 0xd800 && code <= 0xdfff) code = 0xfffd
    if (code < 0x80) {
      bytes.push(code)
    } else if (code < 0x800) {
      bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f))
    } else if (code < 0x10000) {
      bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f))
    } else {
      bytes.push(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 0x3f),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f),
      )
    }
  }
  return bytes
}

function base64Utf8(value: string): string {
  const bytes = utf8Bytes(value)
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i] ?? 0
    const b = bytes[i + 1]
    const c = bytes[i + 2]
    const chunk = (a << 16) | ((b ?? 0) << 8) | (c ?? 0)
    out += BASE64_ALPHABET.charAt((chunk >> 18) & 63)
    out += BASE64_ALPHABET.charAt((chunk >> 12) & 63)
    out += b === undefined ? '=' : BASE64_ALPHABET.charAt((chunk >> 6) & 63)
    out += c === undefined ? '=' : BASE64_ALPHABET.charAt(chunk & 63)
  }
  return out
}

/** ABS takes tag and genre names in delete paths as URI-encoded base64 of UTF-8.
 *  Written by hand because core has no DOM or Node, and clients differ on btoa. */
export function encodeNamePathParam(name: string): string {
  return encodeURIComponent(base64Utf8(name))
}
