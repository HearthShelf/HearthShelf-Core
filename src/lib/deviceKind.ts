// Classify a listening session's origin from its ABS deviceInfo.
//
// The ABS server stores whatever the client sent in `deviceInfo` and enriches
// it with osName/browserName parsed from the User-Agent for browser clients.
// Native clients (mobile, CarPlay, Android Auto) send a stable `clientName` +
// `deviceId` but no browser/OS, so those are the reliable signal for them. We
// check the client identity first, then fall back to OS/browser heuristics for
// third-party or unknown clients.

import type { ABSDeviceInfo } from '../types/abs.ts'

export type DeviceKind = 'car' | 'phone' | 'tablet' | 'browser' | 'desktop'

export interface DeviceKindInfo {
  kind: DeviceKind
  /** Material Symbols glyph name for this kind. */
  icon: string
  /** Short human label, e.g. "Android Auto", "Phone", "Web". */
  label: string
}

const ICONS: Record<DeviceKind, string> = {
  car: 'directions_car',
  phone: 'smartphone',
  tablet: 'tablet',
  browser: 'language',
  desktop: 'computer',
}

function has(hay: string | undefined, ...needles: string[]): boolean {
  if (!hay) return false
  const h = hay.toLowerCase()
  return needles.some((n) => h.includes(n))
}

export function classifyDevice(info: ABSDeviceInfo | undefined): DeviceKindInfo {
  const id = info?.deviceId
  const client = info?.clientName
  const os = info?.osName
  const browser = info?.browserName
  const name = info?.deviceName

  // 1. The web player running in in-car (large touch) mode tags itself.
  if (has(id, 'web-car')) {
    return { kind: 'car', icon: ICONS.car, label: 'Car (Web)' }
  }

  // 2. Our own native in-car clients announce themselves by deviceId first
  //    (most stable), then clientName as a fallback.
  if (has(id, 'carplay', 'auto') || has(client, 'auto', 'carplay')) {
    const label = has(id, 'carplay') || has(client, 'carplay') ? 'CarPlay' : 'Android Auto'
    return { kind: 'car', icon: ICONS.car, label }
  }

  // 3. Third-party clients that name themselves as automotive.
  if (has(client, 'android auto', 'carplay', 'car')) {
    return { kind: 'car', icon: ICONS.car, label: 'Car' }
  }

  // 4. Tablets before phones (a tablet UA often also matches the mobile OS).
  if (has(os, 'ipados') || has(name, 'ipad', 'tablet')) {
    return { kind: 'tablet', icon: ICONS.tablet, label: 'Tablet' }
  }

  // 5. Phones: our mobile client, or a mobile OS from the parsed UA.
  if (has(id, 'mobile') || has(client, 'mobile') || has(os, 'android', 'ios', 'iphone')) {
    return { kind: 'phone', icon: ICONS.phone, label: 'Phone' }
  }

  // 6. A parsed browser means a web session on a computer.
  if (browser) {
    return { kind: 'browser', icon: ICONS.browser, label: 'Web' }
  }

  // 7. Nothing distinctive - treat as a desktop client.
  return { kind: 'desktop', icon: ICONS.desktop, label: 'Desktop' }
}
