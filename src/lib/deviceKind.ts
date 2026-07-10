// Classify a listening session's origin from its ABS deviceInfo.
//
// The ABS server stores whatever the client sent in `deviceInfo` and enriches
// it with osName/browserName parsed from the User-Agent for browser clients.
// Native clients (mobile, CarPlay, Android Auto) send a stable `clientName` +
// `deviceId`, and our phone app now also stamps `osName` ("iOS"/"Android") so an
// Apple phone can be told apart from an Android one. We check the client
// identity first, then fall back to OS/browser heuristics for third-party or
// unknown clients.
//
// The `kind` is a platform token, not a Material Symbols glyph - Material
// Symbols has no Apple/Android brand logos, so each UI maps the token to its own
// brand icon (mobile: MaterialCommunityIcons apple/android; web: inline SVG).

import type { ABSDeviceInfo } from '../types/abs.ts'

/** Where a listening session came from, as a brand/surface the UI can icon. */
export type DeviceKind =
  /** Native app on an Apple phone/tablet (iPhone, iPad). */
  | 'apple'
  /** Native app on an Android phone/tablet. */
  | 'android'
  /** An in-car surface: CarPlay, Android Auto, or the web player's car mode. */
  | 'car'
  /** A normal web browser. */
  | 'web'
  /** Unknown / generic desktop client. */
  | 'desktop'

export interface DeviceKindInfo {
  kind: DeviceKind
  /** Platform token, same as `kind`. Each UI maps this to its own brand icon. */
  icon: DeviceKind
  /** Short human label, e.g. "Apple", "Android", "CarPlay", "Web". */
  label: string
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

  // 1. In-car surfaces come first - a CarPlay session is on an Apple device, but
  //    we want the car icon, not the Apple one. The web player's in-car mode and
  //    our two native head-unit clients all announce themselves by deviceId.
  if (has(id, 'web-car')) {
    return { kind: 'car', icon: 'car', label: 'Car (Web)' }
  }
  if (has(id, 'carplay') || has(client, 'carplay')) {
    return { kind: 'car', icon: 'car', label: 'CarPlay' }
  }
  if (has(id, 'auto') || has(client, 'android auto', 'auto')) {
    return { kind: 'car', icon: 'car', label: 'Android Auto' }
  }
  // Third-party clients that name themselves as automotive (e.g. Tesla browser).
  if (has(client, 'car', 'tesla')) {
    return { kind: 'car', icon: 'car', label: 'Car' }
  }

  // 2. Our phone app stamps osName so Apple and Android split apart. deviceId
  //    also carries the platform suffix ("hearthshelf-mobile-ios"/"-android").
  if (
    has(os, 'ios', 'iphone', 'ipad', 'mac') ||
    has(id, 'ios', 'iphone', 'ipad') ||
    has(name, 'iphone', 'ipad')
  ) {
    return { kind: 'apple', icon: 'apple', label: 'Apple' }
  }
  if (has(os, 'android') || has(id, 'android') || has(client, 'android')) {
    return { kind: 'android', icon: 'android', label: 'Android' }
  }

  // 3. Older phone sessions predate the platform stamp: a generic mobile client
  //    with no OS. We cannot tell Apple from Android, so fall back to Android's
  //    generic phone-shaped glyph rather than guessing a brand.
  if (has(id, 'mobile') || has(client, 'mobile')) {
    return { kind: 'android', icon: 'android', label: 'Phone' }
  }

  // 4. Our own web client. ABS only fills browserName/osName from a real
  //    User-Agent, but the web player opens sessions with a bespoke
  //    deviceId ("hearthshelf-web") + clientName ("HearthShelf") and no UA
  //    parse, so those sessions arrive with browserName undefined. Match them
  //    by identity here, before the browser fallback, so a browser listen reads
  //    as "Web" instead of falling through to the generic desktop glyph.
  //    (The in-car web player, "hearthshelf-web-car", is already caught in 1.)
  if (has(id, 'web') || has(client, 'hearthshelf')) {
    return { kind: 'web', icon: 'web', label: 'Web' }
  }

  // 5. A parsed browser means a third-party web session.
  if (browser) {
    return { kind: 'web', icon: 'web', label: 'Web' }
  }

  // 6. Nothing distinctive - treat as a generic desktop client.
  return { kind: 'desktop', icon: 'desktop', label: 'Desktop' }
}
