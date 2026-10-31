<img src="assets/icon.svg" width="64" height="64" alt="System69 Manager">

# System69 Manager

A Windows desktop workspace combining software removal with Node.js version and PATH management. Uses the Foundry block logo in Signal cobalt, a light theme, and subtle blue selections.

## Install

Windows 10/11 x64. Run `release/System69-Manager-Setup-1.1.1.exe`. The installer bundles Electron and a self-contained .NET helper; users do not need Node.js or .NET installed. Chocolatey setup is optional on the installer setup page. Builds are unsigned.

## Applications and uninstall queue

Search and filter Windows registrations, Microsoft Store, WinGet, and Chocolatey entries. Optionally include Homebrew formulae from the default WSL distribution. Multiple sources can describe the same app; choose one source per app.

Check applications, choose **Review queue**, review the command and exact cleanup folder, acknowledge the review, and start the batch. A native confirmation lists the applications before execution. Silent only is enabled by default; entries without documented quiet commands are blocked. Turn it off before reviewing to permit interactive uninstallers. **Stop after current** allows the running uninstaller to finish before stopping the queue.

Hide and unhide checked entries using the selection bar. Hidden preferences persist per Windows user in the app data folder. Enable **Show hidden apps** to restore them. Hidden applications cannot be queued. Hiding or refreshing invalidates pending reviews. Node.js entries are removed from the runtimes page to retain PATH and running-process checks.

Advanced cleanup is off by default. It only removes a reviewed Windows app-specific InstallLocation under Program Files or LocalAppData/Programs after successful uninstall, disappearance of registration, and a fresh ownership check. It blocks system/shared directories, app installation roots, links, junctions, traversal, and uncertain ownership. Guarded deletion inspects and quarantines the folder, then deletes entries with repeated boundary checks. It does not search or erase arbitrary app data or registry entries. Reboot-required results skip cleanup and stop the queue. Timed-out uninstallers are left running and further mutations are blocked until the operation is resolved and System69 is restarted.

## Node.js, PATH, and packages

Discover installed Node.js versions, source, installation date and provenance, observed usage, running state, and saved PATH priority. Reliable historical last-use dates are often unavailable; use is recorded when a running node.exe is observed during a scan.

Install SHA-256 verified official ZIPs side by side; add existing folders; check the latest stable patch within each major. Prereleases in the official catalog are excluded. The release catalog is cached for offline use.

Edit User and Machine PATH entries, reorder or remove entries, review and save with a backup, or undo the most recent save. Optimistic concurrency rejects stale edits. Machine PATH generally precedes User PATH. Existing terminals retain their current environment.

The Packages view installs/upgrades/uninstalls the allowlisted Node.js Chocolatey packages, including exact versions. Other Chocolatey, WinGet, Store, and WSL Homebrew removals are available in Applications. Homebrew requires `/home/linuxbrew/.linuxbrew/bin/brew` in the default WSL distro. Use **Run as administrator** for machine-level operations. A shared operation lock prevents simultaneous software, runtime, package, and PATH mutations.

## Disk map

Choose **Disk map** and enter a folder or drive; the picker defaults to `C:\`. A worker thread scans without freezing the interface, and **Cancel scan** stops the scan. Tile area represents logical file bytes, not allocated disk space. Hard links are counted per directory entry. Links/junctions are skipped and inaccessible entries are reported. Scans cover all readable contents without an automatic entry or time cutoff. A live overview shows the drive’s top-level folders while scanning. The display retains a bounded tree with smaller details summarized while preserving folder byte totals. Choose **Visible depth** (1–6 levels), or **Map this folder** to expand a particular folder in detail.

Right-click a tile or list entry to **Map this folder**, **Reveal in File Explorer**, or **Delete… (Recycle Bin)** when eligible. Mapping a folder starts a fresh scan with that folder as the root. The current root path is always shown. The largest-entry list also provides keyboard access to selection and context menus.

Deletion is checked in the native backend and requires a separate native confirmation. It is restricted to scanned items on fixed local disks. The map root, drive roots, Windows/system/recovery directories, Program Files, ProgramData, AppData, registered installation locations, other user profiles, profile and known-folder roots, System69 files/data, critical component files, and hidden/system/read-only/offline items are protected. Links, junctions, mount points, cloud reparse points, network/device paths, alternate streams, traversal, and ambiguous names are rejected. A folder containing protected or unreadable content cannot be deleted. Deletion inspection is bounded to 100,000 entries and 64 levels.

The native helper inspects the complete candidate, records the reviewed state, checks it again after confirmation, atomically moves it to a uniquely named sibling, and checks again before passing it to the Recycle Bin. There is no application fallback to permanent deletion. If recycling fails, it restores the item where possible; if recovery is blocked, the remaining path is reported and logged. Recycled items retain a safety prefix in their name. These conservative rules deliberately retain some content that could be deleted manually. They do not defend against a malicious administrator racing filesystem operations.

**Map with System69** is opt-in. Enable/remove it with the button at the bottom of Disk map, or select the unchecked directory-menu option in the installer. It creates only the app-specific per-user `HKCU/Software/Classes/Directory/shell/System69.Map` verb. Windows 11 lists classic verbs under **Show more options**. Invoking it opens the requested folder in Disk map, including when System69 is already running. Uninstall removes the app's verb for the uninstalling Windows user; other users can remove their own entry using the in-app button. Nothing is registered just by launching the app.

## Data

The new app uses `%APPDATA%/system69-manager` for managed runtimes, hidden preferences, release cache, PATH backups, and activity.log. The original apps and their data are left in place. Existing runtime folders can be added manually; source ownership still controls removal.

## Development

Requires Node.js, npm, and the .NET 10 SDK to build. This checkout also recognizes the SDK previously installed under `%TEMP%/system69-build-tools/dotnet`; set `SYSTEM69_DOTNET` to an explicit dotnet.exe if needed.

```powershell
npm ci
npm run build:native
npm start
npm test
npm run check
npm run test:bridge
npm run test:desktop
npm run test:disk
npm run test:disk-delete
npm run dist
npm run test:packaged
npm run test:disk:packaged
```

`npm run build:native` runs the native safety tests and publishes a self-contained helper. `npm run dist` builds the helper and the NSIS installer. `npm start -- --demo` uses sample inventory and prevents system mutations. Desktop checks cover application search, hide/unhide, review, runtime filtering, PATH drafts, permissions, packages, activity, and install dialogs. Live inventory checks only scan inventory and write isolated preferences. The dedicated disk-delete check creates uniquely named disposable files under Downloads, exercises failed-recycle restoration and a Recycle Bin move, and preserves a neighboring test file. No pre-existing user files are deleted, no software is uninstalled, and system PATH is unchanged.

Release limits: installer and executables are unsigned. Real vendor uninstall, UAC, restart, and elevated package-manager workflows still require a disposable Windows VM release pass. Silent behavior depends on each vendor uninstaller and package script.

## Implementation

- `src/ui`: shared Electron interface and Signal theme.
- `src/core`: Node runtime/PATH backend, native service client, uninstall queue coordination.
- `native/System69.Core`: inherited command and guarded cleanup policies.
- `native/System69.Bridge`: JSON service for inventory, review tokens, and policy-controlled uninstall/cleanup.
- `tests`: Node regression suite and the native command, cleanup, and disk-deletion safety tests.
- `design-options`: the three original design proposals.
