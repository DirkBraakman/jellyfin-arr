# Jellyfin \*arr Stack

A self-hosted media server stack built around Jellyfin, with full automation, subtitle management, a request portal, and a dashboard. Designed for **Intel QuickSync** hardware transcoding and compatible with both **Unraid** and plain **Debian/Linux**.

All configuration lives in a single `.env` file. No editing of the compose file is needed.

---

## Containers

| Container      | Purpose                                                        |
| -------------- | -------------------------------------------------------------- |
| `jellyfin`     | Media server - Streams movies and shows to all your devices    |
| `seerr`        | Request portal - Users can request new movies and shows        |
| `radarr`       | Movie automation - Monitors, grabs, and organises movies       |
| `sonarr`       | TV show automation - Monitors, grabs, and organises shows      |
| `prowlarr`     | Indexer manager - Supplies Radarr and Sonarr with sources      |
| `flaresolverr` | Cloudflare bypass - Lets Prowlarr access protected indexers    |
| `bazarr`       | Subtitle automation - Fetches subtitles for your media library |
| `qbittorrent`  | Torrent download client                                        |
| `sabnzbd`      | Usenet/NZB download client                                     |
| `tdarr`        | Media transcoding - Batch converts your library (QuickSync)    |
| `profilarr`    | Quality profile manager - Syncs profiles to Radarr and Sonarr  |
| `wizarr`       | Invite manager - Onboard new Jellyfin users with invite links  |
| `homepage`     | Dashboard - Overview of all services with live stats           |
| `cloudflared`  | Cloudflare tunnel - Exposes Jellyfin and Seerr over HTTPS      |

---

## Prerequisites

- Docker and Docker Compose installed
- An Intel CPU with QuickSync support (7th gen or newer recommended)
- A Cloudflare account with a domain and a configured tunnel token
- Your media and downloads directories ready on the host

---

## Quick Start

### 1. Find your system values

```bash
# Your user and group ID
id yourusername

# The render group ID (needed for QuickSync)
getent group render

# The docker group ID (needed for Homepage's Docker socket access)
getent group docker
```

### 2. Configure .env

Copy `.env` and fill in your values:

```
# System
PUID=1000               # your user ID
PGID=1000               # your group ID
RENDER_GID=107          # render group ID from above
DOCKER_GID=999          # docker group ID from above
TZ=Europe/Amsterdam
UMASK=002
LAN_IP=192.168.x.x      # your server's local IP

# Paths - adjust for your system
# Unraid defaults:
APPDATA=/mnt/user/appdata (cache)
MEDIA=/mnt/user/media (array)
DOWNLOADS=/mnt/user/downloads (cache)

# Cloudflare
CLOUDFLARED_TOKEN=your_tunnel_token
HOMEPAGE_DOMAIN=yourdomain.com or dashboard.yourdomain.com
JELLYFIN_DOMAIN=jellyfin.yourdomain.com
SEERR_DOMAIN=request.yourdomain.com
```

> **Unraid:** The default paths (`/mnt/user/...`) work out of the box.
> **Debian/other Linux:** Change the paths to match your setup, e.g. `/appdata`, `/media`, `/downloads`.

### 3. First run

```bash
docker compose up -d
```

All containers will start. Continue to the next steps to configure credentials and API keys before restarting.

---

## Post-Start Configuration

Most services need to be configured once via their web UI. Go through them in this order.

### 4. Create accounts and note API keys

Visit each service and create your admin account. Then find/make and copy the API key.

| Service  | URL                  | Where to find the API key    |
| -------- | -------------------- | ---------------------------- |
| Jellyfin | `http://LAN_IP:8096` | Dashboard → API Keys → +     |
| Radarr   | `http://LAN_IP:7878` | Settings → General → API Key |
| Sonarr   | `http://LAN_IP:8989` | Settings → General → API Key |
| Prowlarr | `http://LAN_IP:9696` | Settings → General → API Key |
| Bazarr   | `http://LAN_IP:6767` | Settings → General → API Key |
| SABnzbd  | `http://LAN_IP:8082` | Config → General → API Key   |
| Seerr    | `http://LAN_IP:5055` | Settings → General → API Key |
| Tdarr    | `http://LAN_IP:8265` | Tools → API Keys             |

For **qBittorrent** (`http://LAN_IP:8081` / or other chosen port), check container log, log in with generated password, set a new password (and username) under Tools → Web UI Options.

### 5. Fill API keys into .env

```
JELLYFIN_API_KEY=your_key
RADARR_API_KEY=your_key
SONARR_API_KEY=your_key
BAZARR_API_KEY=your_key
SABNZBD_API_KEY=your_key
SEERR_API_KEY=your_key
TDARR_API_KEY=your_key

QBITTORRENT_USER=admin
QBITTORRENT_PASS=your_password
```

### 6. Restart the stack

```bash
docker compose up -d
```

This applies all API keys to Homepage so the dashboard widgets start working.

---

## Linking Services Together

The services need to be connected to each other via their web UIs.

**Prowlarr** (Settings → Apps)

- Add Radarr - use `http://radarr:7878` and the Radarr API key
- Add Sonarr - use `http://sonarr:8989` and the Sonarr API key
- Add FlareSolverr as a proxy - use `http://flaresolverr:8191`
- Add your indexers under Indexers

**Radarr & Sonarr** (Settings → Download Clients)

- Add qBittorrent - `http://qbittorrent:8081` (Internal port changes aswell, choose chosen port (default 8081))
- Add SABnzbd - `http://sabnzbd:8080`

**Bazarr** (Settings → Radarr / Sonarr)

- Connect to Radarr — `http://radarr:7878`
- Connect to Sonarr — `http://sonarr:8989`

**Seerr** (Settings → Services)

- Connect to Jellyfin — `http://jellyfin:8096`
- Connect to Radarr — `http://radarr:7878`
- Connect to Sonarr — `http://sonarr:8989`

**Profilarr** (Settings)

- Connect to Radarr and Sonarr using their internal URLs and API keys

**Wizarr** (Settings)

- Connect to Jellyfin — `http://jellyfin:8096`

---

## Cloudflare Tunnel Setup

This stack uses `cloudflared` to securely expose Jellyfin and Seerr over HTTPS without opening ports on your router.
These containers are hardenend to some extent. It is recommended to install the JellyfinSecurity plugin as soon as you can. (https://github.com/ZL154/JellyfinSecurity)

1. Go to [Cloudflare Zero Trust](https://one.dash.cloudflare.com/) → Networks → Connectors → Published application routes
2. Create a new tunnel and copy the token
3. Add the token to `.env` as `CLOUDFLARED_TOKEN`
4. In the tunnel's published application routes, configure:
   - `jellyfin.yourdomain.com` → `http://jellyfin:8096`
   - `request.yourdomain.com` → `http://seerr:5055`
   - `yourdomain.com` (optional, for Homepage) → `http://homepage:3000`
5. Restart: `docker compose restart cloudflared`

---

## Intel QuickSync

Jellyfin and Tdarr both have `/dev/dri` mapped for hardware transcoding.

After starting Jellyfin, enable QuickSync under:
Dashboard → Playback → Transcoding → Hardware acceleration → Intel QuickSync Video

Set `RENDER_GID` in `.env` to the GID of the `render` group on your host (`getent group render`).

> If your system does not have QuickSync, remove the `devices` and `group_add` sections from the `jellyfin` and `tdarr` services in `compose.yml`.

---

## Ports Reference

| Service      | Port |
| ------------ | ---- |
| Jellyfin     | 8096 |
| Seerr        | 5055 |
| Radarr       | 7878 |
| Sonarr       | 8989 |
| Prowlarr     | 9696 |
| Bazarr       | 6767 |
| qBittorrent  | 8081 |
| SABnzbd      | 8082 |
| Tdarr        | 8265 |
| FlareSolverr | 8191 |
| Profilarr    | 6868 |
| Wizarr       | 5690 |
| Homepage     | 3000 |

All ports are configurable via `.env`.

---

## Useful Commands

```bash
# Start the stack
docker compose up -d

# Stop the stack
docker compose down

# View logs for a specific container
docker compose logs -f jellyfin

# Restart a single container
docker compose restart radarr

# Pull latest images and recreate (update all containers)
docker compose pull && docker compose up -d
```

## Notes

- Never commit .env — it contains secrets (.gitignore is set up)
- Only Jellyfin, Seerr, Homepage and Wizarr are exposed via Cloudflare
- All other services are LAN-only
