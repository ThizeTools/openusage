import { useCallback } from "react"
import {
  saveStartOnLogin,
} from "@/lib/settings"

type UseSettingsSystemActionsArgs = {
  setStartOnLogin: (value: boolean) => void
  applyStartOnLogin: (value: boolean) => Promise<void>
}

export function useSettingsSystemActions({
  setStartOnLogin,
  applyStartOnLogin,
}: UseSettingsSystemActionsArgs) {
  const handleStartOnLoginChange = useCallback((value: boolean) => {
    setStartOnLogin(value)
    void saveStartOnLogin(value).catch((error) => {
      console.error("Failed to save start on login:", error)
    })
    void applyStartOnLogin(value).catch((error) => {
      console.error("Failed to update start on login:", error)
    })
  }, [applyStartOnLogin, setStartOnLogin])

  return {
    handleStartOnLoginChange,
  }
}
