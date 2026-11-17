import { AccountDialog } from "@/components/accounts/account-dialog"
import { ProviderIcon } from "@/components/accounts/provider-icon"
import { Button } from "@/components/ui/button"
import type { AccountProvider } from "@/lib/accounts"

type AddAccountPickerProps = {
  providers: AccountProvider[]
  onPick: (provider: AccountProvider) => void
  onClose: () => void
}

export function AddAccountPicker({ providers, onPick, onClose }: AddAccountPickerProps) {
  return (
    <AccountDialog title="Add account">
      {providers.length === 0 ? (
        <p className="text-sm text-muted-foreground">No providers support sign-in yet.</p>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          {providers.map((provider) => (
            <button
              key={provider.id}
              type="button"
              onClick={() => onPick(provider)}
              className="flex items-center gap-2 rounded-md border bg-background px-3 py-2 text-left text-sm transition-colors hover:bg-muted"
            >
              <ProviderIcon iconUrl={provider.iconUrl} brandColor={provider.brandColor} className="size-5" />
              <span className="truncate">{provider.name}</span>
            </button>
          ))}
        </div>
      )}
      <div className="flex justify-end">
        <Button type="button" variant="outline" size="sm" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </AccountDialog>
  )
}
