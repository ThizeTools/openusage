import { useCallback, useEffect, useState } from "react"
import { invoke, isTauri } from "@tauri-apps/api/core"
import { useAccountsChanged } from "@/hooks/app/use-accounts-changed"
import { errorMessage, type Account, type AccountProvider } from "@/lib/accounts"

/** Accounts and sign-in providers, reloaded whenever accounts change. */
export function useAccounts() {
  const [accounts, setAccounts] = useState<Account[] | null>(null)
  const [providers, setProviders] = useState<AccountProvider[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      const [nextAccounts, nextProviders] = await Promise.all([
        invoke<Account[]>("list_accounts"),
        invoke<AccountProvider[]>("list_account_providers"),
      ])
      setAccounts(nextAccounts)
      setProviders(nextProviders)
      setError(null)
    } catch (err) {
      console.error("Failed to load accounts:", err)
      setError(errorMessage(err))
    }
  }, [])

  useEffect(() => {
    if (!isTauri()) return
    void refresh()
  }, [refresh])

  useAccountsChanged(() => {
    void refresh()
  })

  return { accounts, providers, error, refresh }
}
