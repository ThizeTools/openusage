import { useState, useEffect, useCallback, useRef } from "react"
import { isTauri } from "@tauri-apps/api/core"
import { check, type Update } from "@tauri-apps/plugin-updater"
import { relaunch } from "@tauri-apps/plugin-process"

/** Background re-check interval. */
const CHECK_INTERVAL_MS = 15 * 60 * 1000
/** Showing the panel re-checks when the last check is older than this. */
const RECHECK_ON_SHOW_MS = 5 * 60 * 1000
/** A hung request (e.g. after the computer slept) must not block every later check. */
const CHECK_TIMEOUT_MS = 30 * 1000
/** Whole update download, generous for slow connections. */
const DOWNLOAD_TIMEOUT_MS = 10 * 60 * 1000

export type UpdateStatus =
  | { status: "idle" }
  | { status: "checking" }
  | { status: "up-to-date" }
  | { status: "downloading"; progress: number } // 0-100, or -1 if indeterminate
  | { status: "installing" }
  | { status: "ready" }
  | { status: "error"; message: string }

interface UseAppUpdateReturn {
  updateStatus: UpdateStatus
  triggerInstall: () => void
  checkForUpdates: () => void
}

export function useAppUpdate(): UseAppUpdateReturn {
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>({ status: "idle" })
  const statusRef = useRef<UpdateStatus>({ status: "idle" })
  const updateRef = useRef<Update | null>(null)
  const mountedRef = useRef(true)
  const inFlightRef = useRef({ checking: false, downloading: false, installing: false })
  const upToDateTimeoutRef = useRef<number | null>(null)
  const lastCheckAtRef = useRef(0)

  const setStatus = useCallback((next: UpdateStatus) => {
    statusRef.current = next
    if (!mountedRef.current) return
    setUpdateStatus(next)
  }, [])

  const checkForUpdates = useCallback(async () => {
    if (!isTauri()) return
    if (inFlightRef.current.checking || inFlightRef.current.downloading || inFlightRef.current.installing) return
    if (statusRef.current.status === "ready") return

    // Clear any pending up-to-date timeout
    if (upToDateTimeoutRef.current !== null) {
      clearTimeout(upToDateTimeoutRef.current)
      upToDateTimeoutRef.current = null
    }
    inFlightRef.current.checking = true
    lastCheckAtRef.current = Date.now()
    setStatus({ status: "checking" })
    try {
      const update = await check({ timeout: CHECK_TIMEOUT_MS })
      inFlightRef.current.checking = false
      if (!mountedRef.current) return
      if (!update) {
        setStatus({ status: "up-to-date" })
        upToDateTimeoutRef.current = window.setTimeout(() => {
          upToDateTimeoutRef.current = null
          if (mountedRef.current) setStatus({ status: "idle" })
        }, 3000)
        return
      }
      if (update) {
        updateRef.current = update
        inFlightRef.current.downloading = true
        setStatus({ status: "downloading", progress: -1 })

        let totalBytes: number | null = null
        let downloadedBytes = 0

        try {
          await update.download((event) => {
            if (!mountedRef.current) return
            if (event.event === "Started") {
              totalBytes = event.data.contentLength ?? null
              downloadedBytes = 0
              setStatus({
                status: "downloading",
                progress: totalBytes ? 0 : -1,
              })
            } else if (event.event === "Progress") {
              downloadedBytes += event.data.chunkLength
              if (totalBytes && totalBytes > 0) {
                const pct = Math.min(100, Math.round((downloadedBytes / totalBytes) * 100))
                setStatus({ status: "downloading", progress: pct })
              }
            } else if (event.event === "Finished") {
              setStatus({ status: "ready" })
            }
          }, { timeout: DOWNLOAD_TIMEOUT_MS })
          setStatus({ status: "ready" })
        } catch (err) {
          console.error("Update download failed:", err)
          setStatus({ status: "error", message: "Download failed" })
        } finally {
          inFlightRef.current.downloading = false
        }
      }
    } catch (err) {
      inFlightRef.current.checking = false
      if (!mountedRef.current) return
      console.error("Update check failed:", err)
      setStatus({ status: "error", message: "Update check failed" })
    }
  }, [setStatus])

  useEffect(() => {
    mountedRef.current = true
    void checkForUpdates()

    const intervalId = setInterval(() => {
      void checkForUpdates()
    }, CHECK_INTERVAL_MS)

    return () => {
      mountedRef.current = false
      clearInterval(intervalId)
      if (upToDateTimeoutRef.current !== null) {
        clearTimeout(upToDateTimeoutRef.current)
      }
    }
  }, [checkForUpdates])

  // A hidden panel can have its timers throttled (macOS), so also check when it is shown.
  useEffect(() => {
    const recheckIfStale = () => {
      if (document.visibilityState === "hidden") return
      if (Date.now() - lastCheckAtRef.current < RECHECK_ON_SHOW_MS) return
      void checkForUpdates()
    }
    window.addEventListener("focus", recheckIfStale)
    document.addEventListener("visibilitychange", recheckIfStale)
    return () => {
      window.removeEventListener("focus", recheckIfStale)
      document.removeEventListener("visibilitychange", recheckIfStale)
    }
  }, [checkForUpdates])

  const triggerInstall = useCallback(async () => {
    const update = updateRef.current
    if (!update) return
    if (statusRef.current.status !== "ready") return
    if (inFlightRef.current.installing || inFlightRef.current.downloading) return

    try {
      inFlightRef.current.installing = true
      setStatus({ status: "installing" })
      await update.install()
      await relaunch()
      setStatus({ status: "idle" })
    } catch (err) {
      console.error("Update install failed:", err)
      setStatus({ status: "error", message: "Install failed" })
    } finally {
      inFlightRef.current.installing = false
    }
  }, [setStatus])

  return { updateStatus, triggerInstall, checkForUpdates }
}
