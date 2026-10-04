/**
 * Print the SHA-1 of the keystore that signs the APK.
 *
 * Google's Android OAuth check is the package name plus the SHA-1 of the signing
 * certificate, and the failure mode is unhelpful: if the pair does not match, Google
 * accepts the request and returns a token that is then rejected for audience, which the
 * app can only report as a failed sign-in. Having the fingerprint to paste into the
 * Google console removes the most common cause of that.
 *
 * The fingerprint follows the keystore, not the project, so it changes with the
 * signing key - this is also why a debug-signed build cannot use the fingerprint of a
 * release keystore, or the other way round.
 *
 *   node scripts/print-sha1.mjs [path-to-keystore] [storepass]
 *
 * With no arguments it uses the debug keystore, which is what the current APKs are
 * signed with.
 */
import { existsSync, readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { homedir } from 'node:os'

function findKeytool() {
  const fromPath = spawnSync('keytool', ['-help'], { shell: true })
  if (fromPath.status === 0 || fromPath.status === 1) return 'keytool'
  const roots = [
    process.env.JAVA_HOME,
    'C:\\Program Files\\Android\\Android Studio\\jbr',
    'C:\\Program Files\\Java',
    'C:\\Program Files\\Eclipse Adoptium',
  ].filter(Boolean)
  for (const root of roots) {
    if (!existsSync(join(root, 'bin', 'keytool.exe'))) continue
    if (spawnSync(join(root, 'bin', 'keytool.exe'), ['-help']).status !== null) {
      return join(root, 'bin', 'keytool.exe')
    }
  }
  return null
}

const debugKeystore = join(homedir(), '.android', 'debug.keystore')
const keystore = process.argv[2] ?? debugKeystore
const storepass = process.argv[3] ?? 'android'

if (!existsSync(keystore)) {
  console.error(`no keystore at ${keystore}`)
  console.error('pass the path to the keystore that signs the APK')
  process.exit(1)
}

const keytool = findKeytool()
if (!keytool) {
  console.error('keytool not found - install a JDK or set JAVA_HOME')
  process.exit(1)
}

const res = spawnSync(keytool, ['-list', '-v', '-keystore', keystore, '-storepass', storepass], {
  encoding: 'utf8',
})
const out = `${res.stdout ?? ''}${res.stderr ?? ''}`
if (res.status !== 0) {
  console.error(out.trim() || 'keytool failed')
  process.exit(1)
}

const alias = out.match(/Alias name:\s*(\S+)/)?.[1]
const sha1 = out.match(/SHA1:\s*([0-9A-F:]+)/)?.[1]
const sha256 = out.match(/SHA256:\s*([0-9A-F:]+)/)?.[1]

if (!sha1) {
  console.error('no SHA-1 in the keytool output')
  process.exit(1)
}

console.log(`keystore  ${keystore}`)
console.log(`alias     ${alias ?? 'unknown'}\n`)
console.log(`SHA-1     ${sha1}`)
if (sha256) console.log(`SHA-256   ${sha256}`)
console.log('\nGoogle Cloud Console -> Credentials -> your Android client ->')
console.log('  Package name  com.khelofire.app   (com.khelofire.admin for the admin APK)')
console.log(`  SHA-1         ${sha1}`)