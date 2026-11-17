import { openUrl } from "@tauri-apps/plugin-opener"
import { AccountDialog } from "@/components/accounts/account-dialog"
import { Button } from "@/components/ui/button"
import type { AccountLogin } from "@/hooks/app/use-account-login"

type LoginDialogProps = {
  login: AccountLogin
  onCancel: () => void
  onRetry: () => void
}

/** Browser sign-in (oauth) and device-code sign-in (device) while the backend waits for the browser. */
export function LoginDialog({ login, onCancel, onRetry }: LoginDialogProps) {
  const { provider } = login

  if (login.status === "failed") {
    return (
      <AccountDialog title={`Sign in to ${provider.name}`}>
        <p role="alert" className="text-sm text-destructive">{login.message}</p>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="button" size="sm" onClick={onRetry}>
            Try again
          </Button>
        </div>
      </AccountDialog>
    )
  }

  const userCode = login.status === "waiting" ? login.userCode : null
  const verificationUrl = login.status === "waiting" ? login.verificationUrl : null

  return (
    <AccountDialog title="Finish signing in in your browser">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <span aria-hidden="true" className="size-4 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent" />
        <span>Waiting for {provider.name}...</span>
      </div>

      {userCode ? (
        <div className="space-y-2">
          <p className="text-sm">Enter this code on the page that opened</p>
          <div className="flex items-center justify-between gap-2 rounded-md bg-muted px-3 py-2">
            <code className="font-mono text-xl font-semibold tracking-widest">{userCode}</code>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                navigator.clipboard.writeText(userCode).catch((error) => console.error("Failed to copy code:", error))
              }}
            >
              Copy
            </Button>
          </div>
        </div>
      ) : null}

      {verificationUrl ? (
        <Button
          type="button"
          variant="link"
          size="sm"
          className="justify-start px-0"
          onClick={() => openUrl(verificationUrl).catch((error) => console.error("Failed to open sign-in page:", error))}
        >
          Open sign-in page again
        </Button>
      ) : null}

      <div className="flex justify-end">
        <Button type="button" variant="outline" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </AccountDialog>
  )
}
