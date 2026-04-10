# Project

*Initialized: 2026-04-10*

## What This Is

Ephemeral image relay server for MCP-based AI agent workflows. Clients (Claude Code, MCP tools) upload screenshots/images via HTTP POST, receive a short-lived URL (`img.kenluu.org/i/<key>`), and downstream agents fetch the image for visual reasoning. All images auto-expire after a configurable TTL (default 2h).

## Core Value

Any client, any upload format (raw binary or multipart/form-data) must produce a valid, downloadable image — zero corruption.

## Success Criteria

Project succeeds when:
- [x] Raw binary PNG uploads produce valid images
- [x] Multipart/form-data uploads produce valid images (fixed 2026-04-10)
- [x] Correct Content-Type headers on download (image/png, not multipart)
- [x] Magic byte fallback detection for misidentified MIME types
- [ ] Multer upgrade to 2.x (deprecation warning, non-blocking)
- [ ] Persistent storage option (currently in-memory index + /tmp)

## Context

Deployed on Hetzner VPS behind Traefik reverse proxy. Single-container Node.js app. Used by Claude Code desktop client for image transport — when Claude needs to share a screenshot, it uploads here and passes the URL. Public domain: `img.kenluu.org`.

## Constraints

- Max file size: 10MB
- TTL: 2 hours (configurable via `TTL_HOURS` env var)
- In-memory index — container restart clears all stored images (by design for ephemeral relay)
- Runs behind Traefik — cert resolver is `traefik-main`, not `letsencrypt`
