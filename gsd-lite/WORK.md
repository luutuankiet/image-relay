# Work Log

## 1. Current Understanding

<current_mode>
maintenance
</current_mode>

<active_task>
none
</active_task>

<parked_tasks>
- Multer 2.x upgrade (npm deprecation warning, non-blocking)
- Persistent storage option (if ephemeral /tmp becomes a problem)
</parked_tasks>

<vision>
Format-agnostic image relay for MCP agent workflows — any client, any upload format, valid image out.
</vision>

<decisions>
- Dual upload path: multer for multipart, express.raw for binary, converge to shared handler
- Magic byte detection as MIME fallback (PNG/JPEG/GIF/WebP)
- In-memory index by design (ephemeral relay, not persistent storage)
</decisions>

<blockers>
none
</blockers>

<next_action>
none — service is stable and deployed
</next_action>

---

## 2. Key Events

| Date | Event | Impact |
|------|-------|--------|
| 2026-04-09 | Initial deployment | image-relay live on img.kenluu.org, raw binary uploads working |
| 2026-04-10 | Fixed multipart/form-data corruption | 6% of uploads (multipart) were producing corrupted files — now all formats work |

---

## 3. Atomic Session Log

### [LOG-001] - [BUG] [EXEC] - Fix multipart/form-data image corruption — Task: ad-hoc
**Timestamp:** 2026-04-10 07:00
**Depends On:** none (first log)

---

#### The Problem

Intermittent image corruption — ~6% of uploads (3 out of 50) produced files that macOS Preview reported as damaged. The corrupted images had no `.png` extension and were served with `Content-Type: multipart/form-data`.

#### Root Cause

`server.js` used `express.raw({ type: '*/*' })` to parse ALL request bodies as raw binary. When clients sent `multipart/form-data` (standard HTTP file upload), the server stored the **entire multipart body** — including boundary markers (`------boundary\r\nContent-Disposition: form-data...`) and MIME headers — as the "image" file.

**Evidence from docker logs:**
```
[upload] f1aa9420f128.png (751724 bytes, image/png)     ← ✅ raw binary, works
[upload] 91175f4ad59c (7661 bytes, multipart/form-data)  ← ❌ no extension, corrupted
```

The filename `91175f4ad59c` (no `.png`) matched the user's corrupted screenshot URL.

#### The Fix

| Change | File | Why |
|--------|------|-----|
| Added `multer` for multipart parsing | `server.js`, `package.json` | Extracts actual file buffer from multipart body |
| Content-Type detection routing | `server.js` lines 90-115 | Routes `multipart/form-data` → multer, everything else → express.raw |
| Magic byte detection fallback | `server.js` `detectMimeFromBuffer()` | Reads first 4-12 bytes to identify PNG/JPEG/GIF/WebP when MIME is wrong |
| `Buffer.isBuffer` guard | `server.js` `handleUpload()` | Prevents 500 crash on empty body (returns 400 instead) |
| `multer.any()` field agnosticism | `server.js` | Accepts file from ANY form field name — doesn't require `file` specifically |

#### Verification

| Test | Method | Result |
|------|--------|--------|
| Raw binary upload | `curl --data-binary` | ✅ `.png` extension, valid magic bytes |
| Multipart upload | `curl -F file=@test.png` | ✅ `.png` extension, valid magic bytes |
| Download content-type | `curl -sI` | ✅ `image/png` (was `multipart/form-data`) |
| Magic byte fallback | Upload with `application/octet-stream` | ✅ Auto-detected as `image/png` |
| Empty body | `curl -X POST` | ✅ Returns 400 (was 500) |
| Public URL (Traefik) | `curl https://img.kenluu.org/...` | ✅ HTTP/2 200, valid PNG |
| Independent verifier subagent | Ran all 5 claims + negative checks | ✅ PASS WITH NOTES |

#### Commits

```
3bb806d fix: handle multipart/form-data uploads — extract image from form body
ae76719 fix: handle empty body gracefully (400 not 500)
6d73091 chore: production docker-compose (port mapping + traefik cert resolver)
```

All pushed to `github.com/luutuankiet/image-relay` main.

---

📦 STATELESS HANDOFF
**Dependency chain:** LOG-001 (standalone)
**What was decided:** Dual upload path (multer + express.raw) with magic byte fallback. In-memory index kept intentionally ephemeral.
**Next action:** None — service is stable. Future: consider multer 2.x upgrade, persistent storage if needed.
**Key file:** `server.js` — the entire application.
