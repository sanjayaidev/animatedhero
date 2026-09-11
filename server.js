const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');

const app = express();
const PORT = process.env.PORT || 3000;

const PUBLIC_DIR = path.join(__dirname, 'public');
const FRAMES_DIR = path.join(PUBLIC_DIR, 'frames');
const UPLOADS_DIR = path.join(__dirname, 'uploads');

for (const dir of [PUBLIC_DIR, FRAMES_DIR, UPLOADS_DIR]) {
  fs.mkdirSync(dir, { recursive: true });
}

// Look for a bundled ffmpeg.exe first (drop it in the project root or in a
// bin/ subfolder), and only fall back to a system-PATH "ffmpeg" if neither
// is found. This means the app works even if ffmpeg was never installed
// system-wide.
const BUNDLED_FFMPEG_CANDIDATES = [
  path.join(__dirname, 'ffmpeg.exe'),
  path.join(__dirname, 'bin', 'ffmpeg.exe'),
  path.join(__dirname, 'ffmpeg', 'ffmpeg.exe'),
  path.join(__dirname, 'ffmpeg'),      // in case of a non-Windows bundled binary
  path.join(__dirname, 'bin', 'ffmpeg')
];

const FFMPEG_PATH = BUNDLED_FFMPEG_CANDIDATES.find(p => fs.existsSync(p)) || 'ffmpeg';

console.log(
  FFMPEG_PATH === 'ffmpeg'
    ? 'No bundled ffmpeg.exe found — using "ffmpeg" from system PATH.'
    : `Using bundled ffmpeg at: ${FFMPEG_PATH}`
);

app.use(express.static(PUBLIC_DIR));

const ALLOWED_EXTENSIONS = ['.mp4', '.mov', '.webm', '.mkv', '.avi', '.m4v'];

const upload = multer({
  dest: UPLOADS_DIR,
  limits: { fileSize: 300 * 1024 * 1024 }, // 300MB safety cap
  fileFilter: (req, file, cb) => {
    // Browsers/containers report inconsistent MIME types for video files,
    // so check the file extension instead of trusting file.mimetype.
    const ext = path.extname(file.originalname).toLowerCase();
    if (ALLOWED_EXTENSIONS.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error(`Unsupported file type "${ext}". Allowed: ${ALLOWED_EXTENSIONS.join(', ')}`));
    }
  }
});

// POST /upload  (multipart/form-data, field name "video")
// Optional fields: fps (default 30), width (default 1280)
app.post('/upload', (req, res) => {
  upload.single('video')(req, res, (uploadErr) => {
    if (uploadErr) {
      // Multer errors (bad file type, file too large, etc.) land here —
      // respond with JSON instead of letting Express fall through to its
      // default HTML error page.
      return res.status(400).json({ error: uploadErr.message });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'No video file received.' });
    }

    const fps = Math.max(1, Math.min(60, parseInt(req.body.fps, 10) || 30));
    const width = Math.max(320, Math.min(3840, parseInt(req.body.width, 10) || 1280));

    const inputPath = req.file.path;

    // Clear old frames before writing new ones.
    fs.readdirSync(FRAMES_DIR).forEach(f => fs.unlinkSync(path.join(FRAMES_DIR, f)));

    const outputPattern = path.join(FRAMES_DIR, 'frame_%04d.jpg');
    const args = [
      '-y',
      '-i', inputPath,
      '-vf', `fps=${fps},scale=${width}:-2`,
      '-q:v', '3',
      outputPattern
    ];

    execFile(FFMPEG_PATH, args, (err, stdout, stderr) => {
      fs.unlink(inputPath, () => {}); // clean up the uploaded source file either way

      if (err) {
        console.error(stderr);
        const hint = FFMPEG_PATH === 'ffmpeg'
          ? 'Is ffmpeg installed and on your PATH, or did you place ffmpeg.exe in the project folder?'
          : `Tried to run the bundled ffmpeg at ${FFMPEG_PATH} — check that file isn't corrupted or blocked.`;
        return res.status(500).json({
          error: `ffmpeg failed. ${hint}`,
          detail: stderr ? stderr.split('\n').slice(-5).join('\n') : String(err)
        });
      }

      const frameFiles = fs.readdirSync(FRAMES_DIR).filter(f => f.endsWith('.jpg'));
      const count = frameFiles.length;

      if (count === 0) {
        return res.status(500).json({ error: 'ffmpeg ran but produced no frames.' });
      }

      fs.writeFileSync(
        path.join(FRAMES_DIR, 'manifest.json'),
        JSON.stringify({ count, fps, width, generatedAt: new Date().toISOString() }, null, 2)
      );

      res.json({ success: true, count, fps, width });
    });
  });
});

app.get('/api/frame-count', (req, res) => {
  const manifestPath = path.join(FRAMES_DIR, 'manifest.json');
  if (fs.existsSync(manifestPath)) {
    return res.json(JSON.parse(fs.readFileSync(manifestPath, 'utf8')));
  }
  // Fall back to counting files if no manifest exists yet.
  const count = fs.readdirSync(FRAMES_DIR).filter(f => f.endsWith('.jpg')).length;
  res.json({ count });
});

// Catch-all JSON error handler, in case anything else throws unexpectedly.
// Without this, Express falls back to an HTML error page, which is what
// caused "Unexpected token '<'" when the frontend tried to parse it as JSON.
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: err.message || 'Unexpected server error.' });
});

app.listen(PORT, () => {
  console.log(`Scroll-scrubber server running at http://localhost:${PORT}`);
  console.log(`  - Upload a video:  http://localhost:${PORT}/upload.html`);
  console.log(`  - View the scrub:  http://localhost:${PORT}/`);
});
