import { copyFileSync, existsSync, writeFileSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const helperResourcePath = join(root, "src-tauri", "resources", "openusage-tray-percent-helper.exe")

if (process.platform !== "win32") {
  if (!existsSync(helperResourcePath)) {
    writeFileSync(helperResourcePath, new Uint8Array())
  }
  process.exit(0)
}

const build = spawnSync("cargo", [
  "build",
  "--release",
  "--manifest-path",
  join(root, "src-tauri", "Cargo.toml"),
  "--bin",
  "openusage-tray-percent-helper",
], {
  cwd: root,
  env: process.env,
  stdio: "inherit",
  shell: true,
})

if (build.status !== 0) {
  process.exit(build.status || 1)
}

copyFileSync(
  join(root, "src-tauri", "target", "release", "openusage-tray-percent-helper.exe"),
  helperResourcePath
)
