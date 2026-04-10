# Architecture

*Mapped: 2026-04-10*

## Project Structure Overview

| Path | Purpose |
|------|--------|
| `server.js` | Express server — upload handler (raw + multipart), download handler, TTL cleanup, magic byte detection |
| `package.json` | Dependencies: express 4.x, multer 1.x |
| `Dockerfile` | Node 22-slim, single-stage build |
| `docker-compose.yml` | Service config: port 7799, Traefik labels, env vars |

## Tech Stack

- **Runtime:** Node.js 22 (slim Docker image)
- **Framework:** Express 4.21
- **Multipart parsing:** Multer 1.4.5-lts.1 (memory storage)
- **Reverse proxy:** Traefik (TLS termination, `img.kenluu.org`)
- **Storage:** `/tmp/image-relay/` (ephemeral, in-container)

## Data Flow

```mermaid
sequenceDiagram
    participant Client as Claude Code / MCP Tool
    participant Traefik as Traefik Proxy
    participant Relay as image-relay:7799
    participant FS as /tmp/image-relay/

    Client->>Traefik: POST /upload (raw binary OR multipart/form-data)
    Traefik->>Relay: Forward request
    alt Content-Type: multipart/form-data
        Relay->>Relay: multer.any() extracts file buffer + mimetype
    else Raw binary
        Relay->>Relay: express.raw() reads body as Buffer
    end
    Relay->>Relay: detectMimeFromBuffer() if MIME unreliable
    Relay->>FS: writeFileSync(key + ext, buffer)
    Relay-->>Client: {url: "https://img.kenluu.org/i/<key>.png", size, ttl}

    Note over Relay: Every 5 min: cleanup expired entries

    Client->>Traefik: GET /i/<key>.png
    Traefik->>Relay: Forward request
    Relay->>FS: sendFile()
    Relay-->>Client: image/png binary
```

## Entry Points

1. **`server.js`** — the entire application in one file. Start here for everything.
2. **`docker-compose.yml`** — env vars (`PORT`, `BASE_URL`, `TTL_HOURS`, `MAX_SIZE_MB`) and Traefik routing labels.
3. **`Dockerfile`** — build steps, base image.

## Key Design Decisions

- **Dual upload path:** Content-Type sniffing routes to multer (multipart) or express.raw (binary). Both converge to `handleUpload(buffer, mime, res)`.
- **Magic byte detection:** Fallback when MIME is wrong (e.g., `application/octet-stream` for a PNG). Checks first 4-12 bytes for PNG/JPEG/GIF/WebP signatures.
- **In-memory index:** Intentional — this is an ephemeral relay, not a CDN. Container restart = clean slate.
