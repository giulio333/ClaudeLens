# macOS code signing and notarization

ClaudeLens currently ships **unsigned**. macOS quarantines the download, the
first launch fails with _"ClaudeLens is damaged and can't be opened"_ or
_"cannot be opened because the developer cannot be verified"_, and every new
user has to be talked through a Terminal command before the app will start —
[README](../README.md#macos), Settings → General, and the update banner all
carry that workaround today.

The release workflow can sign and notarize instead. It is **opt-in**: with the
Apple secrets configured, the mac job signs with a Developer ID certificate and
notarizes; without them it produces the same unsigned DMG as before, so forks
and secret-less runs keep working. This document is the setup.

Everything on the repository side is already in place — entitlements
(`build/entitlements.mac.*.plist`), the `build.mac` block in `package.json`, and
the conditional path in `.github/workflows/release.yml`. What is missing is an
Apple Developer account and five GitHub secrets.

---

## What it costs

- **Apple Developer Program membership — $99/year.** There is no free tier for
  Developer ID signing. A free Apple ID can only sign apps for the machine that
  built them, which does nothing for distribution.
- **~5–15 extra minutes per release**, waiting on Apple's notary service.

Nothing else changes: the app stays outside the Mac App Store, unsandboxed, and
free to read `~/.claude`.

---

## Setup

You only do this once. Steps 1–2 need a Mac; the rest is browser and GitHub.

### 1. Create a Developer ID Application certificate

Only the **Developer ID Application** type works for distribution outside the
App Store. Do not use "Apple Development" or "Mac App Distribution".

1. On your Mac, open **Keychain Access** → menu **Keychain Access** →
   **Certificate Assistant** → **Request a Certificate From a Certificate
   Authority…**
2. Enter your email and name, select **Saved to disk**, and save the
   `CertificateSigningRequest.certSigningRequest` file.
3. Go to [developer.apple.com/account/resources/certificates](https://developer.apple.com/account/resources/certificates),
   click **+**, choose **Developer ID Application**, and upload the CSR.
4. Download the resulting `.cer` and double-click it to install it into your
   login keychain.

### 2. Export it as a `.p12`

1. In **Keychain Access** → **My Certificates**, find
   `Developer ID Application: <your name> (<TEAMID>)`.
2. Right-click → **Export…** → format **Personal Information Exchange (.p12)**.
   Expand the certificate first and confirm it has a private key underneath — a
   `.p12` exported without one cannot sign.
3. Set a strong export password and keep it; it becomes
   `MACOS_CERTIFICATE_PASSWORD`.
4. Base64-encode it for GitHub:

   ```bash
   base64 -i ClaudeLens.p12 | tr -d '\n' | pbcopy
   ```

   The `tr` matters — a secret with embedded newlines fails to decode in CI.

### 3. Create an app-specific password

Notarization authenticates as your Apple ID, and will not accept your real
password.

1. Go to [appleid.apple.com](https://appleid.apple.com) → **Sign-In and
   Security** → **App-Specific Passwords**.
2. Generate one (name it e.g. `ClaudeLens notarization`) and copy the
   `xxxx-xxxx-xxxx-xxxx` value.

### 4. Find your Team ID

[developer.apple.com/account](https://developer.apple.com/account) →
**Membership details** → **Team ID**. Ten characters, e.g. `A1B2C3D4E5`. It is
also the part in parentheses in your certificate's name.

### 5. Add the GitHub secrets

**Settings → Secrets and variables → Actions → New repository secret**, five
times:

| Secret                        | Value                                       |
| ----------------------------- | ------------------------------------------- |
| `MACOS_CERTIFICATE`           | base64 of the `.p12` from step 2            |
| `MACOS_CERTIFICATE_PASSWORD`  | the `.p12` export password                  |
| `APPLE_ID`                    | the Apple ID email of the developer account |
| `APPLE_APP_SPECIFIC_PASSWORD` | the app-specific password from step 3       |
| `APPLE_TEAM_ID`               | the Team ID from step 4                     |

The workflow takes the signed path only when `MACOS_CERTIFICATE`, `APPLE_ID` and
`APPLE_TEAM_ID` are all set. A partial set silently falls back to unsigned, so
add all five.

### 6. Release and check

Cut a release as usual (see [CLAUDE.md](../CLAUDE.md#release)). In the mac job:

- **Package mac** should not print the "Unsigned macOS build" warning.
- **Verify signature and notarization** runs `codesign --verify`,
  `spctl --assess` and `xcrun stapler validate` against both architectures. The
  job fails if any of them rejects the app, so a broken signature cannot reach a
  release unnoticed.

Then confirm on a real machine — ideally one that has never run a ClaudeLens
build, since Gatekeeper caches verdicts per app:

```bash
# Download the DMG through a browser so it actually carries the quarantine flag,
# then, after dragging to /Applications:
spctl --assess --type execute --verbose=4 /Applications/ClaudeLens.app
# → /Applications/ClaudeLens.app: accepted
#   source=Notarized Developer ID
```

Double-clicking should open the app with no Terminal step and no scary dialog.

---

## After it works: clean up the workarounds

Signing makes three pieces of user-facing text wrong. They are intentionally
left in place until a signed build has actually shipped — remove them in a
follow-up, not in advance:

- `README.md` — the `xattr -d com.apple.quarantine` step in **Installation →
  macOS**, and the sentence in **Updates** that explains why there is no
  auto-install.
- `src/components/project/settings/SettingsView.tsx` — the `QUARANTINE_CMD`
  block in `UpdatesBlock` (Settings → General).
- `src/components/UpdateBanner.tsx` — the "Unsigned build" footnote.

Signing also unblocks **automatic updates**, which are off today for exactly
this reason: Squirrel.Mac refuses unsigned bundles, and a silently swapped app
would land quarantined anyway. Once releases are signed and notarized,
`electron-updater` becomes a real option. That is a separate piece of work with
its own failure modes — treat it as a follow-up, not part of this change.

---

## Troubleshooting

**`No identity found` / the build is unsigned despite the secrets.** The `.p12`
was exported without its private key, or the base64 has newlines in it. Re-do
step 2, expanding the certificate to confirm the key is included, and re-copy
with the `tr -d '\n'` above.

**Notarization fails with `Team is not yet configured for notarization`.** A new
Developer Program membership can take up to ~24h to be enabled for the notary
service. Retry the next day.

**Notarization fails with `Invalid` and mentions the hardened runtime.** The app
was signed without `hardenedRuntime` or without the entitlements — notarization
requires both. `package.json` sets them; check nothing overrode `build.mac`.

**Notarization is rejected for an unsigned nested binary.** Something under
`asarUnpack` (node-pty, the Agent SDK) shipped a helper electron-builder did not
sign. Get the log for the exact path:

```bash
xcrun notarytool log <submission-id> \
  --apple-id "$APPLE_ID" --team-id "$APPLE_TEAM_ID" --password "$APPLE_APP_SPECIFIC_PASSWORD"
```

**The app is notarized but still warns on first launch.** The ticket is probably
not stapled — without it Gatekeeper has to reach Apple, which fails offline. The
release job's `xcrun stapler validate` catches this; if it passed and users still
see a warning, check that they are not running a cached older copy.

---

## Signing locally (optional)

Not needed for releases — CI does it — but useful when debugging entitlements.
With the certificate in your login keychain:

```bash
npm run build

export APPLE_ID="you@example.com"
export APPLE_APP_SPECIFIC_PASSWORD="xxxx-xxxx-xxxx-xxxx"
export APPLE_TEAM_ID="A1B2C3D4E5"

npx electron-builder --mac -c.mac.notarize=true
```

To package unsigned the way CI does without secrets:

```bash
CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --mac
```
