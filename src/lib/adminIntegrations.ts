// Integration and community settings logic for the server admin area.
import type { HSCommunityConfig } from '../types/hs.ts'

/** Audible catalog regions by code. */
export const AUDIBLE_REGION_LABELS: Record<string, string> = {
  us: 'United States',
  ca: 'Canada',
  uk: 'United Kingdom',
  au: 'Australia',
  in: 'India',
  de: 'Germany',
  es: 'Spain',
  fr: 'France',
}

/** QuestGiver AI providers by id. */
export const QG_PROVIDER_LABELS: Record<string, string> = {
  openai: 'OpenAI (or compatible)',
  anthropic: 'Anthropic Claude',
  gemini: 'Google Gemini',
  copilot: 'GitHub Copilot',
}

const DEFAULT_PORTS: Record<string, string> = { http: '80', https: '443' }

function decodeQueryPart(part: string): string {
  const spaced = part.replace(/\+/g, ' ')
  try {
    return decodeURIComponent(spaced)
  } catch {
    return spaced
  }
}

// Split by hand so this runs the same everywhere: core has no URL global, and React
// Native's has a history of unimplemented origin and searchParams. Handles what a
// pasted link can hold: any case, credentials, a port, a sub-path and encoded query
// values. It doesn't resolve ".." in a path or convert non-ASCII host names.
function splitHttpUrl(value: string): { origin: string; path: string; query: string } | null {
  const match = /^(https?):\/\/[/\\]*([^/\\?#]*)([^?#]*)(?:\?([^#]*))?/i.exec(value)
  if (!match) return null
  const scheme = match[1].toLowerCase()
  const authority = match[2].slice(match[2].lastIndexOf('@') + 1).toLowerCase()
  const hostPort = /^(.*?)(?::(\d*))?$/.exec(authority)
  const host = hostPort?.[1]
  if (!host || /[\s<>^|%]/.test(host) || (host.includes(':') && !host.startsWith('['))) return null
  const port = hostPort?.[2] ? String(Number(hostPort[2])) : ''
  if (Number(port) > 65535) return null
  const origin = `${scheme}://${host}${port && port !== DEFAULT_PORTS[scheme] ? `:${port}` : ''}`
  return { origin, path: match[3].replace(/\\/g, '/'), query: match[4] ?? '' }
}

function queryParam(query: string, name: string): string | null {
  for (const pair of query.split('&')) {
    const eq = pair.indexOf('=')
    const key = eq < 0 ? pair : pair.slice(0, eq)
    if (decodeQueryPart(key) === name) return eq < 0 ? '' : decodeQueryPart(pair.slice(eq + 1))
  }
  return null
}

/** Accepts either a bare ReadMeABook login token or the whole login link. From a
 *  link it takes the token and the server address the link points at. */
export function parseRmabLoginTokenInput(value: string): {
  token: string
  baseUrl: string | null
} {
  const trimmed = value.trim()
  if (!/^https?:\/\//i.test(trimmed)) return { token: value, baseUrl: null }
  const parsed = splitHttpUrl(trimmed)
  if (!parsed) return { token: value, baseUrl: null }
  const markerAt = parsed.path.indexOf('/auth/token/login')
  const token = queryParam(parsed.query, 'token')?.trim()
  if (markerAt < 0 || !token) return { token: value, baseUrl: null }
  const basePath = parsed.path.slice(0, markerAt)
  return { token, baseUrl: `${parsed.origin}${basePath}`.replace(/\/$/, '') }
}

/** A warning when a pasted login link points at a different server than the Server
 *  URL field, or null when they agree or either is empty. */
export function rmabUrlMismatch(baseUrl: string | null, currentUrl: string): string | null {
  if (!baseUrl || !currentUrl.trim()) return null
  const normalizedCurrent = currentUrl.trim().replace(/\/$/, '').toLowerCase()
  if (normalizedCurrent === baseUrl.toLowerCase()) return null
  return `The login URL is for ${baseUrl}, but Server URL is ${currentUrl.trim()}. Verify that both addresses reach the same ReadMeABook server.`
}

/** A neutral, non-editable config for when the read fails. */
export const COMMUNITY_CONFIG_FALLBACK: HSCommunityConfig = {
  defaultShare: true,
  defaultShareListening: false,
  notesEnabled: true,
  clubsEnabled: true,
  canEdit: false,
}

/** Fills in what an older server left out of /hs/social/community-config. */
export function mapCommunityConfig(data: Partial<HSCommunityConfig>): HSCommunityConfig {
  return {
    defaultShare: data.defaultShare ?? true,
    defaultShareListening: data.defaultShareListening ?? false,
    notesEnabled: data.notesEnabled ?? true,
    clubsEnabled: data.clubsEnabled ?? true,
    canEdit: Boolean(data.canEdit),
  }
}
