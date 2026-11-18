// Bumps the app version everywhere it must match the release tag, then prints the commands to publish.
// Usage: bun scripts/release.mjs 0.7.0
import { readFileSync, writeFileSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const version = process.argv[2]

if (!/^\d+\.\d+\.\d+$/.test(version ?? "")) {
  console.error("Usage: bun scripts/release.mjs X.Y.Z")
  process.exit(1)
}

function setVersion(file, pattern) {
  const path = join(root, file)
  const text = readFileSync(path, "utf8")
  if (!pattern.test(text)) throw new Error(`No version field found in ${file}`)
  writeFileSync(path, text.replace(pattern, (_, before, after) => `${before}${version}${after}`))
}

setVersion("package.json", /("version":\s*")[^"]+(")/)
setVersion("src-tauri/tauri.conf.json", /("version":\s*")[^"]+(")/)
setVersion("src-tauri/Cargo.toml", /(^version\s*=\s*")[^"]+(")/m)

// Keep Cargo.lock in step (the publish workflow builds with the lockfile).
const lock = spawnSync("cargo", ["update", "-p", "openusage", "--offline"], {
  cwd: join(root, "src-tauri"),
  stdio: "inherit",
})
if (lock.status !== 0) console.error("cargo update failed: run it in src-tauri before committing.")

console.log(`
Version set to ${version}. Next:

  git add package.json src-tauri/tauri.conf.json src-tauri/Cargo.toml src-tauri/Cargo.lock
  git commit -m "Release v${version}"
  git tag v${version}
  git push && git push origin v${version}

GitHub Actions then builds Windows + Mac and publishes the release with latest.json.
`)
