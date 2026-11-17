import { AccountRow } from "@/components/accounts/account-row"
import { ProviderIcon } from "@/components/accounts/provider-icon"
import type { Account, AccountProvider } from "@/lib/accounts"

type AccountListProps = {
  accounts: Account[]
  providers: AccountProvider[]
}

function groupByProvider(accounts: Account[]): { providerId: string; accounts: Account[] }[] {
  const groups = new Map<string, Account[]>()
  for (const account of accounts) {
    const group = groups.get(account.provider)
    if (group) group.push(account)
    else groups.set(account.provider, [account])
  }
  return Array.from(groups, ([providerId, items]) => ({ providerId, accounts: items }))
}

/** Accounts grouped under their provider. */
export function AccountList({ accounts, providers }: AccountListProps) {
  return (
    <div className="space-y-3">
      {groupByProvider(accounts).map(({ providerId, accounts: items }) => {
        const provider = providers.find((candidate) => candidate.id === providerId)
        return (
          <div key={providerId} className="space-y-1">
            <div className="flex items-center gap-2 px-1 text-sm font-medium text-muted-foreground">
              {provider ? (
                <ProviderIcon iconUrl={provider.iconUrl} brandColor={provider.brandColor} className="size-4" />
              ) : null}
              <span>{provider?.name ?? providerId}</span>
            </div>
            <div className="bg-muted/50 rounded-lg p-1 space-y-1">
              {items.map((account) => (
                <AccountRow key={account.id} account={account} />
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}
