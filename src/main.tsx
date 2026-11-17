import React from "react";
import ReactDOM from "react-dom/client";
import { error as logError, warn as logWarn } from "@tauri-apps/plugin-log";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { App } from "./App";
import { SettingsWindowApp } from "./settings-window/SettingsWindowApp";
import "./index.css";

function getWindowLabel(): string {
  try {
    return getCurrentWindow().label;
  } catch {
    return "main";
  }
}

// Forward console.error and console.warn to Tauri log file
function stringify(arg: unknown): string {
  if (arg === null) return "null";
  if (arg === undefined) return "undefined";
  if (typeof arg === "string") return arg;
  if (arg instanceof Error) return `${arg.name}: ${arg.message}`;
  try {
    return JSON.stringify(arg);
  } catch {
    return String(arg);
  }
}

const originalError = console.error;
console.error = (...args: unknown[]) => {
  originalError(...args);
  logError(args.map(stringify).join(" ")).catch(() => {});
};

const originalWarn = console.warn;
console.warn = (...args: unknown[]) => {
  originalWarn(...args);
  logWarn(args.map(stringify).join(" ")).catch(() => {});
};

function pickRoot() {
  switch (getWindowLabel()) {
    case "settings":
      return SettingsWindowApp;
    default:
      return App;
  }
}

const Root = pickRoot();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
);
