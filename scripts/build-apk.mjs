/**
 * Build one Android APK.
 *
 *   node scripts/build-apk.mjs user    -> dist-apk/KheloFire.apk        (com.khelofire.app)
 *   node scripts/build-apk.mjs admin   -> dist-apk/KheloFire-Admin.apk  (com.khelofire.admin)
 *
 * The two are separate packages on purpose: installing one must never replace the
 * other, so an operator can hold the admin console and the player app on the same
 * phone without either one silently swapping itself out for the other.
 *
 * Why a script instead of an npm "build:admin" line: the whole chain needs
 * VITE_ADMIN_BUILD=true, and it needs it set during `cap sync` as well as during
 * `vite build`, because capacitor.config.ts reads it to write the package id and
 * the custom URL scheme into strings.xml. Prefixing env vars in a package.json
 * script is not portable across cmd/bash, and half-applying the flag leaves a
 * build whose label says Admin and whose deep links open the player app.
 */
import { spawnSync } from 'node:child_process'
import { mkdirSync, copyFileSync, existsSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const target = process.argv[2] === 'admin' ? 'admin' : 'user'

const targets = {
  user: {
    flag: 'false',
    gradle: 'assembleUserDebug',
    out: 'app/build/outputs/apk/user/debug/app-user-debug.apk',
    apk: 'KheloFire.apk',
  },
  admin: {
    // Read by main.tsx (opens straight into /admin) and by capacitor.config.ts
    // (package id + URL scheme). Both need it, hence one env for the whole chain.
    flag: 'true',
    gradle: 'assembleAdminDebug',
    out: 'app/build/outputs/apk/admin/debug/app-admin-debug.apk',
    apk: 'KheloFire-Admin.apk',
  },
}

const cfg = targets[target]

/**
 * Find a JDK that can compile this project.
 *
 * The gradle config sets VERSION_21, so JDK 17 fails with a bare
 * "invalid source release: 21" and nothing else useful. This machine in
 * particular already exports a JAVA_HOME pointing at 17, which is why that error
 * kept coming back - so an existing JAVA_HOME is not evidence of a usable JDK and
 * has to be probed rather than trusted.
 *
 * Preference order: an ambient JAVA_HOME that is genuinely 21 or newer, then the
 * portable JDK already unpacked beside this checkout. Returning null lets gradle
 * fall back to whatever is on PATH and report its own error.
 */
function findJdk() {
  const portable = join(
    process.env.LOCALAPPDATA ?? '',
    'Temp', 'opencode', 'jdk21', 'jdk-21.0.12.1+1',
  )

  const candidates = []
  if (process.env.JAVA_HOME) candidates.push(process.env.JAVA_HOME)
  candidates.push(portable)

  for (const home of candidates) {
    const javac = join(home, 'bin', 'javac.exe')
    if (!existsSync(javac)) continue
    const res = spawnSync(javac, ['-version'], { encoding: 'utf8', shell: true })
    const out = `${res.stdout ?? ''}${res.stderr ?? ''}`
    const major = Number(/javac (\d+)/.exec(out)?.[1])
    if (Number.isFinite(major) && major >= 21) {
      process.stdout.write(`using JDK ${major} at ${home}\n`)
      return home
    }
    if (Number.isFinite(major)) {
      process.stdout.write(`skipping JDK ${major} at ${home} (need 21+)\n`)
    }
  }
  return null
}

const jdk = findJdk()
if (jdk) process.env.JAVA_HOME = jdk

const steps = [
  ['typecheck', []],
  ['vite', ['build']],
  ['sync', []],
  ['gradle', []],
]

function run(cmd, args, label) {
  process.stdout.write(`\n=== ${label} ===\n`)
  const res = spawnSync(cmd, args, {
    cwd: root,
    stdio: 'inherit',
    shell: true,
    env: { ...process.env, VITE_ADMIN_BUILD: cfg.flag },
  })
  if (res.status !== 0) {
    process.stderr.write(`\n${label} failed (exit ${res.status})\n`)
    process.exit(res.status ?? 1)
  }
}

// npx is resolved through the local node_modules first so this does not depend on
// a global install.
run('npx', ['tsc', '-b', '--force'], 'typecheck')
run('npx', ['vite', 'build'], 'vite build')
run('npx', ['cap', 'sync', 'android'], 'cap sync')

const android = join(root, 'android')
process.stdout.write(`\n=== gradle ${cfg.gradle} ===\n`)
const gradle = spawnSync('gradlew.bat', [cfg.gradle, '--console=plain'], {
  cwd: android,
  stdio: 'inherit',
  shell: true,
  env: process.env,
})
if (gradle.status !== 0) {
  process.stderr.write(`\ngradle failed (exit ${gradle.status})\n`)
  process.exit(gradle.status ?? 1)
}

const built = join(android, cfg.out)
if (!existsSync(built)) {
  process.stderr.write(`\napk not found at ${built}\n`)
  process.exit(1)
}

const destDir = join(root, 'dist-apk')
mkdirSync(destDir, { recursive: true })
const dest = join(destDir, cfg.apk)
copyFileSync(built, dest)

process.stdout.write(
  `\n${target} APK -> ${dest} (${(statSync(dest).size / 1024 / 1024).toFixed(1)} MB)\n`,
)
void steps