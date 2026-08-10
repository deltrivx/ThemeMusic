# Theme Music

[简体中文](README.md) | **English** | [Release Index](RELEASES.md)

[![Latest Release](https://img.shields.io/github/v/release/deltrivx/ThemeMusic?display_name=tag&sort=semver&label=latest)](https://github.com/deltrivx/ThemeMusic/releases/latest)
[![Unraid](https://img.shields.io/badge/Unraid-6.12%2B-F15A2C?logo=unraid&logoColor=white)](https://unraid.net/)
[![License](https://img.shields.io/badge/license-GPL--2.0-blue)](LICENSE)
[![Assets](https://img.shields.io/badge/assets-CC%20BY--NC--SA%204.0-8a2be2)](LICENSE-ASSETS.md)

Theme Music is a native Unraid WebGUI music player that brings three configurable sources into the dashboard and site-wide playback experience: local music directories, Navidrome/OpenSubsonic, and the FnOS music HTTP API.

> Current release: **v1.3.22** · Plugin ID: `theme.music` · Minimum Unraid version: **6.12.0**

## Features

- Three configurable sources: local directories, Navidrome/OpenSubsonic, and FnOS music HTTP API.
- Native dashboard music card and site-wide music capsule with synchronized playback state.
- Playback controls, playlists, search, sorting, shuffle, repeat modes, progress, and volume.
- Local LRC/TXT lyrics, Navidrome structured lyrics, FnOS remote lyrics, and lyric timing adjustment.
- Directory artwork, FLAC embedded covers, Navidrome covers, and controlled cover matching.
- Large-library indexing with a low-priority single background task, caching, filtering, sorting, and segmented rendering.
- Independent desktop and mobile profiles for mode, volume, autoplay, shuffle, repeat, sidebar, and resume state.
- Local-disk wake-up and SMB/NFS readiness detection with separate storage handling.
- SHA256-verified release archives, differential OTA updates, rollback, and flash recovery.
- Credentials are stored separately with restrictive permissions and are not exposed to the browser or logs.

## Playback modes

| Mode | Dashboard card | Site-wide capsule | Continues outside dashboard |
|---|:---:|:---:|:---:|
| `card` | Yes | No | No |
| `chip` | No | Yes | Yes |
| `both` | Yes | Yes | Yes |

The card and capsule share one playback state. Mobile can inherit the desktop profile or use an independent profile. Site-wide playback uses an inline `<audio>` element and does not create extra popups or host windows.

## Installation

In the Unraid WebGUI, open **Plugins -> Install Plugin** and paste:

```text
https://raw.githubusercontent.com/deltrivx/ThemeMusic/main/theme.music.plg
```

After installation, open **Settings -> User Preferences -> Theme Music**, enable the master switch, and configure a source.

You can also use the standalone installer:

```bash
curl -fsSL https://raw.githubusercontent.com/deltrivx/ThemeMusic/main/scripts/install.sh | sh
```

To install a specific version in OTA mode:

```bash
curl -fsSL https://raw.githubusercontent.com/deltrivx/ThemeMusic/main/scripts/install.sh -o /tmp/theme-music-install.sh
sh /tmp/theme-music-install.sh install v1.3.7 ota
```

## Source configuration

### Local directory

Select **Local directory** and configure a path such as `/mnt/user/...`, `/mnt/diskN/...`, or a mounted CIFS/NFS music directory. The plugin detects common audio formats, sidecar `.lrc`/`.txt` lyrics, directory artwork, and embedded FLAC images.

### Navidrome / OpenSubsonic

Provide the server URL, username, and password, then test the connection. The plugin accesses the Subsonic API through an Unraid same-origin proxy, so the browser never receives the upstream password.

### FnOS music HTTP API

Provide the FnOS music service URL, username, and password, then test the connection. Theme Music supports remote tracks, covers, duration, playback, and lyrics, with a single automatic re-login retry when a token expires.

Unconfigured or unavailable sources are skipped with an explicit status and do not block other sources.

## Data and security

- General settings: `/boot/config/plugins/theme.music/theme-music.cfg`
- Service switch: `/boot/config/plugins/theme.music/theme.music.cfg`
- Navidrome secret: `/boot/config/plugins/theme.music/navidrome.secret`
- FnOS secret: `/boot/config/plugins/theme.music/fnos.secret`
- Runtime: `/usr/local/emhttp/plugins/theme.music/`
- Web API: `/plugins/theme.music/ucwc-music-api.php`

Passwords are stored separately with mode `0600`. The project does not upload music files, playback history, or account credentials.

## Compatibility and boundaries

- Supports Unraid 6.12 and later.
- Requires the `curl`, `jq`, PHP, and PHP cURL facilities normally provided by Unraid.
- Theme Music is independent from Theme Effects; do not enable legacy music components from Theme Effects at the same time.
- This is an independent community project and is not an official Unraid, Navidrome, or OpenSubsonic project.

## Documentation and support

- [Project overview](ABOUT.md)
- [Changelog](CHANGELOG.md)
- [Contributing](CONTRIBUTING.md)
- [Security policy](SECURITY.md)
- [Troubleshooting and support](SUPPORT.md)

## License

Program source code is licensed under the [GNU GPL-2.0](LICENSE). Original documentation and visual assets are licensed separately under [CC BY-NC-SA 4.0](LICENSE-ASSETS.md). Third-party names, trademarks, icons, and services remain subject to their respective rights; see [NOTICE](NOTICE).
