import { useCallback, useEffect, useRef, useState } from "react"
import { invoke, isTauri } from "@tauri-apps/api/core"
import { listen } from "@tauri-apps/api/event"
import {
  ACCOUNTS_LOGIN_FINISHED_EVENT,
  errorMessage,
  type AccountProvider,
  type LoginFinished,
  type LoginStarted,
} from "@/lib/accounts"

export type AccountLogin =
  | { status: "starting"; provider: AccountProvider }
  | {
      status: "waiting"
      provider: AccountProvider
      loginId: string
      verificationUrl: string | null
      userCode: string | null
    }
  | { status: "failed"; provider: AccountProvider; message: string }

/**
 * One sign-in at a time for oauth/device providers. The backend opens the
 * browser; completion arrives as `accounts:login-finished`.
 */
export function useAccountLogin(onSignedIn: () => void) {
  const [login, setLoginState] = useState<AccountLogin | null>(null)
  const loginRef = useRef<AccountLogin | null>(null)
  // Bumped on every begin/cancel so a start that resolves after the dialog was closed is stopped.
  const attemptRef = useRef(0)
  const onSignedInRef = useRef(onSignedIn)

  const setLogin = useCallback((next: AccountLogin | null) => {
    loginRef.current = next
    setLoginState(next)
  }, [])

  useEffect(() => {
    onSignedInRef.current = onSignedIn
  }, [onSignedIn])

  useEffect(() => {
    if (!isTauri()) return
    let cancelled = false
    let unlisten: (() => void) | undefined

    void listen<LoginFinished>(ACCOUNTS_LOGIN_FINISHED_EVENT, (event) => {
      const current = loginRef.current
      const payload = event.payload
      if (current?.status !== "waiting" || current.loginId !== payload.loginId) return
      if (payload.ok) {
        setLogin(null)
        onSignedInRef.current()
        return
      }
      if (payload.error === "cancelled") {
        setLogin(null)
        return
      }
      setLogin({
        status: "failed",
        provider: current.provider,
        message: payload.error ?? "Sign-in failed",
      })
    })
      .then((fn) => {
        if (cancelled) fn()
        else unlisten = fn
      })
      .catch((error) => console.error("Failed to listen for sign-in results:", error))

    return () => {
      cancelled = true
      unlisten?.()
    }
  }, [setLogin])

  const begin = useCallback(
    async (provider: AccountProvider) => {
      attemptRef.current += 1
      const attempt = attemptRef.current
      setLogin({ status: "starting", provider })
      try {
        const started = await invoke<LoginStarted>("start_account_login", { providerId: provider.id })
        if (attemptRef.current !== attempt) {
          await invoke("cancel_account_login", { loginId: started.loginId }).catch((error) =>
            console.error("Failed to cancel abandoned sign-in:", error)
          )
          return
        }
        setLogin({
          status: "waiting",
          provider,
          loginId: started.loginId,
          verificationUrl: started.verificationUrl ?? null,
          userCode: started.userCode ?? null,
        })
      } catch (error) {
        if (attemptRef.current !== attempt) return
        console.error("Failed to start sign-in:", error)
        setLogin({ status: "failed", provider, message: errorMessage(error) })
      }
    },
    [setLogin]
  )

  const cancel = useCallback(async () => {
    const current = loginRef.current
    attemptRef.current += 1
    if (current?.status !== "waiting") {
      setLogin(null)
      return
    }
    try {
      await invoke("cancel_account_login", { loginId: current.loginId })
      setLogin(null)
    } catch (error) {
      console.error("Failed to cancel sign-in:", error)
      setLogin({ status: "failed", provider: current.provider, message: errorMessage(error) })
    }
  }, [setLogin])

  return { login, begin, cancel }
}
