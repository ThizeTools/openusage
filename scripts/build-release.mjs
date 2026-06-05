import { existsSync, rmSync, readFileSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const envPath = join(root, ".env")

if (existsSync(envPath)) {
  const envText = readFileSync(envPath, "utf8")
  for (const line of envText.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/)
    if (!match) continue
    let value = match[2].trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    process.env[match[1]] = value
  }
}

const signingKeyPath = process.env.TAURI_SIGNING_PRIVATE_KEY
if (signingKeyPath && existsSync(signingKeyPath)) {
  process.env.TAURI_SIGNING_PRIVATE_KEY = readFileSync(signingKeyPath, "utf8")
}

rmSync(join(root, "src-tauri", "target", "release", "bundle"), { recursive: true, force: true })

const result = spawnSync("bun", ["tauri", "build", ...process.argv.slice(2)], {
  cwd: root,
  env: process.env,
  stdio: "inherit",
  shell: process.platform === "win32",
})

if (result.status !== 0) {
  process.exit(result.status || 1)
}

console.log("\n✓ Build complete. Output under src-tauri/target/release/bundle")
