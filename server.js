const express = require('express');
const multer = require('multer');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3456;
const STORE_DIR = '/tmp/image-relay';
const TTL_MS = (process.env.TTL_HOURS || 1) * 3600 * 1000;
const MAX_SIZE = (process.env.MAX_SIZE_MB || 10) * 1024 * 1024;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;

// Ensure store directory exists
fs.mkdirSync(STORE_DIR, { recursive: true });

// In-memory index: key -> {filename, mime, created, size}
const index = new Map();

// Cleanup expired entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of index) {
    if (now - entry.created > TTL_MS) {
      try { fs.unlinkSync(path.join(STORE_DIR, key)); } catch {}
      index.delete(key);
    }
  }
}, 5 * 60 * 1000);

// Multer for multipart/form-data uploads (memory storage)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_SIZE }
});

// Determine MIME type and extension
function getExtension(mime) {
  if (mime.includes('png')) return '.png';
  if (mime.includes('jpeg') || mime.includes('jpg')) return '.jpg';
  if (mime.includes('gif')) return '.gif';
  if (mime.includes('webp')) return '.webp';
  if (mime.includes('svg')) return '.svg';
  return '';
}

// Detect actual MIME from magic bytes if Content-Type is unreliable
function detectMimeFromBuffer(buf) {
  if (!buf || buf.length < 8) return null;
  // PNG: 89 50 4E 47
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47) return 'image/png';
  // JPEG: FF D8 FF
  if (buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) return 'image/jpeg';
  // GIF: 47 49 46 38
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38) return 'image/gif';
  // WEBP: 52 49 46 46 ... 57 45 42 50
  if (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
      buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50) return 'image/webp';
  return null;
}

// Core upload handler — works with both raw and multipart-extracted buffers
function handleUpload(buffer, mime, res) {
  if (!buffer || !Buffer.isBuffer(buffer) || buffer.length === 0) {
    return res.status(400).json({ error: 'Empty body' });
  }

  // If MIME looks wrong (e.g. still multipart), try detecting from magic bytes
  if (!mime || mime.includes('multipart') || mime === 'application/octet-stream') {
    const detected = detectMimeFromBuffer(buffer);
    if (detected) mime = detected;
  }

  const key = crypto.randomUUID().replace(/-/g, '').slice(0, 12);
  const ext = getExtension(mime);
  const filename = `${key}${ext}`;

  fs.writeFileSync(path.join(STORE_DIR, filename), buffer);
  index.set(filename, { mime, created: Date.now(), size: buffer.length });

  const url = `${BASE_URL}/i/${filename}`;
  console.log(`[upload] ${filename} (${buffer.length} bytes, ${mime}) -> ${url}`);
  res.json({ key, filename, url, size: buffer.length, ttl_seconds: TTL_MS / 1000 });
}

// Upload: POST /upload
// Supports both raw binary body AND multipart/form-data
app.post('/upload', (req, res, next) => {
  const contentType = req.headers['content-type'] || '';

  if (contentType.startsWith('multipart/form-data')) {
    // Multipart: parse with multer, extract the file buffer
    upload.any()(req, res, (err) => {
      if (err) {
        console.error(`[upload] multer error: ${err.message}`);
        return res.status(400).json({ error: err.message });
      }
      if (!req.files || req.files.length === 0) {
        return res.status(400).json({ error: 'No file in multipart body' });
      }
      // Take the first file from any field name
      const file = req.files[0];
      const mime = file.mimetype || 'application/octet-stream';
      console.log(`[upload] multipart detected: field=${file.fieldname}, originalName=${file.originalname}, mimetype=${mime}`);
      handleUpload(file.buffer, mime, res);
    });
  } else {
    // Raw binary upload
    express.raw({ type: '*/*', limit: MAX_SIZE })(req, res, (err) => {
      if (err) {
        console.error(`[upload] raw parse error: ${err.message}`);
        return res.status(400).json({ error: err.message });
      }
      const mime = contentType || 'application/octet-stream';
      handleUpload(req.body, mime, res);
    });
  }
});

// Download: GET /i/:filename
app.get('/i/:filename', (req, res) => {
  const entry = index.get(req.params.filename);
  if (!entry) return res.status(404).json({ error: 'Not found or expired' });

  const filePath = path.join(STORE_DIR, req.params.filename);
  if (!fs.existsSync(filePath)) {
    index.delete(req.params.filename);
    return res.status(404).json({ error: 'File missing' });
  }

  res.set('Content-Type', entry.mime);
  res.set('Cache-Control', 'public, max-age=3600');
  res.sendFile(filePath);
});

// Health
app.get('/health', (req, res) => {
  res.json({ ok: true, stored: index.size, uptime: process.uptime() | 0 });
});

app.listen(PORT, () => {
  console.log(`[image-relay] listening on :${PORT}`);
  console.log(`[image-relay] base_url=${BASE_URL}, ttl=${TTL_MS/1000}s, max=${MAX_SIZE} bytes`);
});
