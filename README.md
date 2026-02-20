# Jellyfin Arr Stack

Automated media server stack: request, download, organize and stream movies & shows.

## Setup

### 1. Cloudflare Tunnel

Create a Cloudflare Tunnel at [Cloudflare Dashboard](https://one.dash.cloudflare.com/) → Networks → Tunnels.

Add 4 public hostname routes pointing to your host's internal IP:

| Subdomain     | Service               |
| ------------- | --------------------- |
| `jellyfin.*`  | `http://HOST_IP:8096` |
| `request.*`   | `http://HOST_IP:5055` |
| `dashboard.*` | `http://HOST_IP:3000` |
| `invite.*`    | `http://HOST_IP:5690` |

Copy the tunnel token for the next step.

### 2. Prepare Host

```bash
# Create non-root user
sudo useradd -u 1000 -m media

# Create directories
sudo mkdir -p /media/{movies,shows,downloads} /containers
sudo chown -R 1000:1000 /media /containers

# Intel GPU drivers (for Jellyfin hardware transcoding)
sudo apt install -y intel-media-va-driver-non-free i965-va-driver
sudo usermod -aG video,render media

# Note the render group ID and docker socket GID
getent group render | cut -d: -f3
stat -c '%g' /var/run/docker.sock
```

### 3. Configure

```bash
cp .env.example .env
```

Fill in `.env` — at minimum set:

- `CLOUDFLARE_TUNNEL_TOKEN`
- `RENDER_GROUP_ID` and `DOCKER_GID` from step 2
- Domain names (`JELLYFIN_DOMAIN`, `JELLYSEERR_DOMAIN`)

### 4. Deploy

```bash
docker compose up -d
```

Or import the stack in Portainer.

### 5. Post-Deploy

1. Open each service and complete initial setup (Jellyfin, Jellyseerr, Radarr, Sonarr, Prowlarr, Bazarr, qBittorrent)
2. Grab API keys from Jellyfin, Jellyseerr, Sonarr, Radarr and add them to `.env`
3. Copy the `homepage/` folder contents to `/containers/homepage/`
4. Re-deploy:

```bash
docker compose up -d
```
