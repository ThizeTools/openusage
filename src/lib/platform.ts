function navigatorPlatform(): string {
  if (typeof navigator === "undefined") return ""
  return navigator.platform ?? ""
}

export function isWindowsPlatform(): boolean {
  return /Win/.test(navigatorPlatform())
}

export function isMacPlatform(): boolean {
  return /Mac/.test(navigatorPlatform())
}

/** Where the usage widget lives: the menu bar on macOS, the taskbar elsewhere. */
export function widgetSurfaceName(): "menu bar" | "taskbar" {
  return isMacPlatform() ? "menu bar" : "taskbar"
}
