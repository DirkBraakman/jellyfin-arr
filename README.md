# Jellyfin Arr Stack

Dockerized auto-download media server for movies, shows & music.

---

## Services

| Service         | Purpose                              | Access            |
| --------------- | ------------------------------------ | ----------------- |
| **Jellyfin**    | Stream media (films, series, muziek) | `http://ip:8096`  |
| **Radarr**      | Auto-download films                  | `http://ip:7878`  |
| **Sonarr**      | Auto-download series                 | `http://ip:8989`  |
| **Prowlarr**    | Torrent indexers/sources             | `http://ip:9696`  |
| **qBittorrent** | Download via VPN                     | Via Radarr/Sonarr |
| **Tdarr**       | GPU transcoding                      | `http://ip:8265`  |
| **Homepage**    | Dashboard                            | `http://ip:3000`  |

---

## 1. Host Setup (One-time)

```bash
# Create folders
sudo mkdir -p /media/{movies,shows,music,downloads}
sudo chown -R 1000:1000 /media

# GPU drivers
sudo apt update
sudo apt install -y intel-media-va-driver-non-free i965-va-driver

# Add to groups
sudo usermod -aG video,render $(id -un 1000)
# Logout/login to apply

# Check render group ID (note the number)
getent group render | cut -d: -f3
```

---

## 2. Cloudflare Tunnel Setup

```bash
# Install cloudflared
curl -L --output cloudflared.deb https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb
sudo dpkg -i cloudflared.deb

# Create tunnel
cloudflared tunnel login
cloudflared tunnel create jellyfin-dashboard
cloudflared tunnel token jellyfin-dashboard
```

**Copy the token** → Paste in `.env` as `CLOUDFLARE_TUNNEL_TOKEN`

---

## 3. Edit .env file

Same folder as `compose.yml`:

---

## 4. Deploy via Portainer

In Portainer:

1. Create Stack
2. Upload `compose.yml`
3. Add environment variables from `.env`
4. Deploy
5. Wait 2-3 min until all green

---

## 5. Configure Cloudflare (After deployment)

Go to: **https://one.dash.cloudflare.com/**

1. **Tunnels** → **jellyfin-dashboard** → **Public Hostname**
2. Add routes:
   - `jellyfin.example.com` → `http://jellyfin:8096`
   - `dashboard.example.com` → `http://homepage:3000`

---

## 6. Where to Access Everything

### Local (LAN - admin only)

- Jellyfin: `http://server-ip:8096` (streaming & admin)
- Radarr: `http://server-ip:7878` (manage films)
- Sonarr: `http://server-ip:8989` (manage shows)
- Prowlarr: `http://server-ip:9696` (manage sources)
- Tdarr: `http://server-ip:8265` (transcoding)
- Homepage: `http://server-ip:3000` (dashboard)

### Internet (Cloudflare - users)

- `https://jellyfin.example.com` (streaming only)
- `https://dashboard.example.com` (dashboard)

---

## 7. Setup Services (After deployment)

**Jellyfin:**

- Go to `http://server-ip:8096` → Complete wizard
- Add libraries: `/media/movies`, `/media/shows`, `/media/music`

**Radarr:**

- Go to `http://server-ip:7878` → Add Prowlarr indexers → Set download folder `/media/downloads`

**Sonarr:**

- Go to `http://server-ip:8989` → Add Prowlarr indexers → Set download folder `/media/downloads`

**qBittorrent:**

- Downloads go to `/media/downloads` (configured in Radarr/Sonarr)
- All traffic through VPN automatically

---

## Adding Arc B580 GPU (Later)

After initial setup, if you add Arc B580:

```bash
# Check available GPUs
ls -la /dev/dri/render*
```

Might be D129 instead of D128!
Edit `compose.yml`, find `jellyfin` and `tdarr` sections, uncomment:

```yaml
devices:
  - /dev/dri/renderD128:/dev/dri/renderD128 # adjust D128/D129 as needed
```




