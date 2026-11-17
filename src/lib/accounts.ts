export const ACCOUNTS_CHANGED_EVENT = "accounts:changed"
export const ACCOUNTS_LOGIN_FINISHED_EVENT = "accounts:login-finished"

export type Account = {
  id: string
  /** Plugin id the account belongs to. */
  provider: string
  label: string
  customLabel: boolean
  createdAt: string
}

export type AccountKeyField = {
  name: string
  label: string
  secret: boolean
}

export type AccountProviderKind = "oauth" | "device" | "api-key"

export type AccountProvider = {
  id: string
  name: string
  iconUrl: string
  brandColor?: string | null
  kind: AccountProviderKind
  keyUrl?: string | null
  fields: AccountKeyField[]
}

export type LoginStarted = {
  loginId: string
  verificationUrl?: string | null
  userCode?: string | null
}

export type LoginFinished = {
  loginId: string
  ok: boolean
  accountId?: string | null
  error?: string | null
}

const API_KEY_FIELD: AccountKeyField = { name: "apiKey", label: "API key", secret: true }

/** Backend contract: a key provider with no declared fields takes one `apiKey` field. */
export function apiKeyFields(provider: AccountProvider): AccountKeyField[] {
  return provider.fields.length > 0 ? provider.fields : [API_KEY_FIELD]
}

/** Tauri rejects with the error string; anything else is stringified. */
export function errorMessage(error: unknown): string {
  if (typeof error === "string") return error
  if (error instanceof Error) return error.message
  return String(error)
}
