import { useId, useState, type FormEvent } from "react"
import { invoke } from "@tauri-apps/api/core"
import { openUrl } from "@tauri-apps/plugin-opener"
import { AccountDialog } from "@/components/accounts/account-dialog"
import { Button } from "@/components/ui/button"
import { apiKeyFields, errorMessage, type AccountProvider } from "@/lib/accounts"

const INPUT_CLASS =
  "h-9 w-full rounded-md border bg-background px-2.5 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"

type ApiKeyFormProps = {
  provider: AccountProvider
  onSaved: () => void
  onCancel: () => void
}

export function ApiKeyForm({ provider, onSaved, onCancel }: ApiKeyFormProps) {
  const baseId = useId()
  const fields = apiKeyFields(provider)
  const keyUrl = provider.keyUrl
  const [values, setValues] = useState<Record<string, string>>({})
  const [label, setLabel] = useState("")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const complete = fields.every((field) => (values[field.name] ?? "").trim() !== "")

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!complete || saving) return
    setSaving(true)
    setError(null)
    try {
      const trimmed = Object.fromEntries(
        fields.map((field) => [field.name, (values[field.name] ?? "").trim()])
      )
      await invoke("add_api_key_account", {
        providerId: provider.id,
        values: trimmed,
        label: label.trim() || undefined,
      })
      onSaved()
    } catch (err) {
      setError(errorMessage(err))
      setSaving(false)
    }
  }

  return (
    <AccountDialog title={`Add ${provider.name} account`}>
      <form className="space-y-3" onSubmit={handleSubmit}>
        {fields.map((field) => {
          const inputId = `${baseId}-${field.name}`
          return (
            <div key={field.name} className="space-y-1">
              <label htmlFor={inputId} className="text-sm font-medium">{field.label}</label>
              <input
                id={inputId}
                type={field.secret ? "password" : "text"}
                autoComplete="off"
                spellCheck={false}
                className={INPUT_CLASS}
                value={values[field.name] ?? ""}
                onChange={(event) => {
                  const value = event.target.value
                  setValues((current) => ({ ...current, [field.name]: value }))
                }}
              />
            </div>
          )
        })}

        <div className="space-y-1">
          <label htmlFor={`${baseId}-name`} className="text-sm font-medium">Name (optional)</label>
          <input
            id={`${baseId}-name`}
            type="text"
            className={INPUT_CLASS}
            value={label}
            onChange={(event) => setLabel(event.target.value)}
          />
        </div>

        {keyUrl ? (
          <Button
            type="button"
            variant="link"
            size="sm"
            className="justify-start px-0"
            onClick={() => openUrl(keyUrl).catch((err) => console.error("Failed to open key page:", err))}
          >
            Get a key
          </Button>
        ) : null}

        {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}

        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" size="sm" onClick={onCancel} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" size="sm" disabled={!complete || saving}>
            Save
          </Button>
        </div>
      </form>
    </AccountDialog>
  )
}
