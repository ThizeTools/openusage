import { useState, type FormEvent, type KeyboardEvent } from "react"
import { invoke } from "@tauri-apps/api/core"
import { AppWindow, Pencil, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { errorMessage, type Account } from "@/lib/accounts"
import { isWindowsPlatform } from "@/lib/platform"

const INPUT_CLASS =
  "h-8 min-w-0 flex-1 rounded-md border bg-background px-2 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"

type AccountRowProps = {
  account: Account
}

/** One account: open in Claude Desktop (Claude, Windows), inline rename (pencil, Enter saves, Escape cancels) and remove with confirm. */
export function AccountRow({ account }: AccountRowProps) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(account.label)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const startEditing = () => {
    setDraft(account.label)
    setError(null)
    setEditing(true)
  }

  const handleRename = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const next = draft.trim()
    if (next === "" || next === account.label) {
      setEditing(false)
      return
    }
    setBusy(true)
    setError(null)
    try {
      await invoke("rename_account", { id: account.id, label: next })
      setEditing(false)
    } catch (err) {
      console.error("Failed to rename account:", err)
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const handleRemove = async () => {
    if (!window.confirm(`Remove "${account.label}"?`)) return
    setBusy(true)
    setError(null)
    try {
      await invoke("remove_account", { id: account.id })
    } catch (err) {
      console.error("Failed to remove account:", err)
      setError(errorMessage(err))
      setBusy(false)
    }
  }

  const handleOpenDesktop = async () => {
    setError(null)
    try {
      await invoke("open_claude_desktop", { accountId: account.id })
    } catch (err) {
      console.error("Failed to open Claude Desktop:", err)
      setError(errorMessage(err))
    }
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") setEditing(false)
  }

  return (
    <div className="rounded-md bg-card px-3 py-2">
      {editing ? (
        <form className="flex items-center gap-2" onSubmit={handleRename}>
          <input
            aria-label="Account name"
            autoFocus
            className={INPUT_CLASS}
            value={draft}
            disabled={busy}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={handleKeyDown}
          />
          <Button type="submit" size="sm" disabled={busy}>Save</Button>
          <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => setEditing(false)}>
            Cancel
          </Button>
        </form>
      ) : (
        <div className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-sm">{account.label}</span>
          {account.provider === "claude" && isWindowsPlatform() ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={`Open ${account.label} in Claude Desktop`}
              title="Open in Claude Desktop"
              disabled={busy}
              onClick={() => void handleOpenDesktop()}
            >
              <AppWindow />
            </Button>
          ) : null}
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={`Rename ${account.label}`}
            disabled={busy}
            onClick={startEditing}
          >
            <Pencil />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={`Remove ${account.label}`}
            disabled={busy}
            onClick={() => void handleRemove()}
          >
            <Trash2 />
          </Button>
        </div>
      )}
      {error ? <p role="alert" className="mt-1 text-xs text-destructive">{error}</p> : null}
    </div>
  )
}
