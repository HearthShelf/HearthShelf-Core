// Centralized user settings - shared by web, hosted, mobile, and the
// /hs/settings backend route. The catalog (see lib/settings) is the single
// definition of every setting: its scope, default, and validation constraint.
// Both clients and the server import it, so "what the UI allows" and "what the
// backend accepts" can never drift. See docs/settings-sync.md in HearthShelf.

// account: syncs to every device the user signs in on.
// device:  backed up per-install, only round-trips for the matching deviceId
//          (reader typography, car mode, library view - device-local by nature).
export type SettingScope = 'account' | 'device'

// A single setting's value. `null` is allowed for tri-state settings like
// shareReadBooks (null = "never chose, follow the server default").
export type SettingValue = boolean | number | string | null | unknown[]

// One catalog entry. The `type` discriminates the constraint fields, so a
// number setting carries min/max and an enum carries its allowed values - the
// validator (validateSetting) reads exactly the fields its type defines.
export type SettingDef =
  | { key: string; scope: SettingScope; secret?: boolean; type: 'boolean'; default: boolean }
  | {
      key: string
      scope: SettingScope
      secret?: boolean
      type: 'number'
      default: number
      min?: number
      max?: number
      int?: boolean
    }
  | {
      key: string
      scope: SettingScope
      secret?: boolean
      type: 'string'
      default: string
      pattern?: RegExp
      maxLen?: number
    }
  | { key: string; scope: SettingScope; secret?: boolean; type: 'enum'; default: string; values: readonly string[] }
  // Tri-state: a boolean that may also be null (user never chose).
  | { key: string; scope: SettingScope; secret?: boolean; type: 'triBool'; default: boolean | null }
  // Arbitrary shape (e.g. queueAutoRules) validated by a predicate.
  | { key: string; scope: SettingScope; secret?: boolean; type: 'json'; default: unknown; validate: (v: unknown) => boolean }

// The catalog, indexed by key for O(1) lookup.
export type SettingsCatalog = Record<string, SettingDef>

// Result of validateSetting: ok carries the (possibly clamped/coerced) value;
// otherwise reason is a short machine-ish string for the client to surface.
export type SettingValidation = { ok: true; value: SettingValue } | { ok: false; reason: string }

// One stored setting with its own conflict timestamp (per-key LWW).
export interface StoredSetting {
  value: SettingValue
  updatedAt: number
}

// A change a client wants to push. updatedAt is stamped by the client at the
// moment of the edit and is the LWW conflict key.
export interface SettingChange {
  scope: SettingScope
  key: string
  value: SettingValue
  updatedAt: number
}

// GET /hs/settings response. Account + device settings as key -> stored value;
// the connection surfaces its non-secret fields only (never the ABS key).
export interface SettingsPullResult {
  account: Record<string, StoredSetting>
  device: Record<string, StoredSetting>
  connection: { absUrl: string; label: string | null; connected: boolean } | null
}

// PUT /hs/settings response. A change lands in exactly one bucket:
//  applied  - written.
//  rejected - a newer value already won the LWW race; adopt the returned value.
//  invalid  - failed the catalog constraint; never written, surface a fix.
export interface SettingsPushResult {
  applied: string[]
  rejected: Array<{ key: string; value: SettingValue; updatedAt: number }>
  invalid: Array<{ key: string; value: SettingValue; reason: string }>
}
