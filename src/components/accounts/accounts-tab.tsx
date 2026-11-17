import { useState } from "react"
import { AccountList } from "@/components/accounts/account-list"
import { AddAccountPicker } from "@/components/accounts/add-account-picker"
import { ApiKeyForm } from "@/components/accounts/api-key-form"
import { LoginDialog } from "@/components/accounts/login-dialog"
import { Button } from "@/components/ui/button"
import { useAccountLogin } from "@/hooks/app/use-account-login"
import { useAccounts } from "@/hooks/app/use-accounts"
import type { AccountProvider } from "@/lib/accounts"

/** Settings → Accounts: list, add (browser, device code or API key), rename, remove. */
export function AccountsTab() {
  const { accounts, providers, error, refresh } = useAccounts()
  const { login, begin, cancel } = useAccountLogin(refresh)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [apiKeyProvider, setApiKeyProvider] = useState<AccountProvider | null>(null)

  const handlePick = (provider: AccountProvider) => {
    setPickerOpen(false)
    if (provider.kind === "api-key") setApiKeyProvider(provider)
    else void begin(provider)
  }

  return (
    <section>
      <h3 className="text-lg font-semibold mb-0">Accounts</h3>
      <p className="text-sm text-muted-foreground mb-2">Sign in to the services you use</p>

      {error ? (
        <div className="mb-2 flex items-center gap-2">
          <p role="alert" className="text-sm text-destructive">Failed to load accounts</p>
          <Button type="button" variant="outline" size="sm" onClick={() => void refresh()}>
            Retry
          </Button>
        </div>
      ) : null}

      {accounts && providers ? (
        accounts.length === 0 ? (
          <p className="text-sm text-muted-foreground mb-2">No accounts yet</p>
        ) : (
          <div className="mb-2">
            <AccountList accounts={accounts} providers={providers} />
          </div>
        )
      ) : error ? null : (
        <p className="text-sm text-muted-foreground mb-2">Loading accounts...</p>
      )}

      <Button type="button" size="sm" disabled={providers === null} onClick={() => setPickerOpen(true)}>
        Add account
      </Button>

      {pickerOpen && providers ? (
        <AddAccountPicker providers={providers} onPick={handlePick} onClose={() => setPickerOpen(false)} />
      ) : null}
      {login ? (
        <LoginDialog
          login={login}
          onCancel={() => void cancel()}
          onRetry={() => void begin(login.provider)}
        />
      ) : null}
      {apiKeyProvider ? (
        <ApiKeyForm
          provider={apiKeyProvider}
          onSaved={() => {
            setApiKeyProvider(null)
            void refresh()
          }}
          onCancel={() => setApiKeyProvider(null)}
        />
      ) : null}
    </section>
  )
}
