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
const VIDEOS_DIR = path.join(PUBLIC_DIR, 'videos');
// Compressed full-length video used by menu-video.html (resolution/fps only; duration is kept)
const VIDEO_WIDTH = parseInt(process.env.VIDEO_WIDTH, 10) || 480;
const VIDEO_FPS = parseInt(process.env.VIDEO_FPS, 10) || 15;
const DATA_FILE = path.join(__dirname, 'menu-data.json');

// The 4 fixed menu groups. Rename or edit here.
const CATEGORIES = [
  { id: 'starters', title: 'Starters' },
  { id: 'mains', title: 'Mains' },
  { id: 'sweets', title: 'Sweets' },
  { id: 'drinks', title: 'Drinks' }
];

for (const d of [PUBLIC_DIR, FRAMES_DIR, UPLOADS_DIR, VIDEOS_DIR]) fs.mkdirSync(d, { recursive: true });
CATEGORIES.forEach(c => fs.mkdirSync(path.join(FRAMES_DIR, c.id), { recursive: true }));

const FFMPEG_PATH = path.join(__dirname, 'ffmpeg');
console.log(`Using bundled ffmpeg: ${FFMPEG_PATH}`);

const loadData = () => { try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch { return {}; } };
const saveData = d => fs.writeFileSync(DATA_FILE, JSON.stringify(d, null, 2));
const loadManifest = id => { try { return JSON.parse(fs.readFileSync(path.join(FRAMES_DIR, id, 'manifest.json'), 'utf8')); } catch { return {}; } };
const SLOTS = 5, SLOT_PCT = 100 / SLOTS; // 10s video, 5 dishes, one every 2s
const blankDishes = () => Array.from({ length: SLOTS }, (_, i) => ({ name: `Dish ${i + 1}`, price: '', url: '', description: '', start: i * SLOT_PCT }));
const validCat = id => CATEGORIES.some(c => c.id === id);

// First-frame poster + all-keyframe H.264 (every frame seekable = smooth scrubbing), no audio, full duration.
function encodeVideo(src, cat, done) {
  const out = path.join(VIDEOS_DIR, `${cat}.mp4`), tmp = path.join(VIDEOS_DIR, `${cat}.tmp.mp4`), poster = path.join(VIDEOS_DIR, `${cat}.jpg`);
  const quiet = ['-y', '-loglevel', 'error', '-i', src];
  execFile(FFMPEG_PATH, [...quiet, '-frames:v', '1', '-vf', `scale=${VIDEO_WIDTH}:-2`, '-q:v', '3', poster], e1 => {
    if (e1) return done(e1);
    execFile(FFMPEG_PATH, [...quiet, '-an', '-vf', `fps=${VIDEO_FPS},scale=${VIDEO_WIDTH}:-2`, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '28', '-g', '1', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', tmp], e2 => {
      if (e2) return done(e2);
      fs.rename(tmp, out, done);
    });
  });
}

app.use(express.json({ limit: '1mb' }));
app.use('/videos', express.static(VIDEOS_DIR, { maxAge: '30d', immutable: true })); // URLs carry ?v=
app.use(express.static(PUBLIC_DIR));

const ALLOWED = ['.mp4', '.mov', '.webm', '.mkv', '.avi', '.m4v'];
const upload = multer({
  dest: UPLOADS_DIR,
  limits: { fileSize: 300 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    ALLOWED.includes(ext) ? cb(null, true) : cb(new Error(`Unsupported file type "${ext}". Allowed: ${ALLOWED.join(', ')}`));
  }
});

// Full menu: categories, frame counts, dishes
app.get('/api/menu', (req, res) => {
  const data = loadData();
  res.json(CATEGORIES.map(c => {
    const manifest = loadManifest(c.id);
    return {
      id: c.id, title: c.title,
      count: data[c.id]?.count || manifest.count || 0,
      version: data[c.id]?.version || Date.parse(manifest.generatedAt) || 0,
      dishes: data[c.id]?.dishes?.length === SLOTS ? data[c.id].dishes : blankDishes()
    };
  }));
});

// Menu data for menu-video.html: poster/video availability + dishes
app.get('/api/menu-video', (req, res) => {
  const data = loadData();
  res.json(CATEGORIES.map(c => {
    let version = 0;
    try { version = Math.round(fs.statSync(path.join(VIDEOS_DIR, `${c.id}.mp4`)).mtimeMs); } catch {}
    return { id: c.id, title: c.title, video: !!version, version,
      dishes: data[c.id]?.dishes?.length === SLOTS ? data[c.id].dishes : blankDishes() };
  }));
});

// Upload video for one category -> frames in public/frames/<id>/
app.post('/api/upload/:cat', (req, res) => {
  const cat = req.params.cat;
  if (!validCat(cat)) return res.status(404).json({ error: 'Unknown category.' });

  upload.single('video')(req, res, err => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'No video file received.' });

    const fps = Math.max(1, Math.min(60, parseInt(req.body.fps, 10) || 24));
    const width = Math.max(320, Math.min(1920, parseInt(req.body.width, 10) || 960));
    const dir = path.join(FRAMES_DIR, cat);
    fs.readdirSync(dir).forEach(f => fs.unlinkSync(path.join(dir, f)));

    const args = ['-y', '-i', req.file.path, '-t', '10', '-vf', `fps=${fps},scale=${width}:-2`, '-q:v', '4', path.join(dir, 'frame_%04d.jpg')];
    execFile(FFMPEG_PATH, args, (e, so, stderr) => {
      if (e) {
        fs.unlink(req.file.path, () => {});
        console.error(stderr);
        return res.status(500).json({ error: 'ffmpeg failed. Check the root-level ffmpeg executable.', detail: (stderr || String(e)).split('\n').slice(-5).join('\n') });
      }
      const count = fs.readdirSync(dir).filter(f => f.endsWith('.jpg')).length;
      if (!count) { fs.unlink(req.file.path, () => {}); return res.status(500).json({ error: 'ffmpeg produced no frames.' }); }

      fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ count, fps, width, generatedAt: new Date().toISOString() }, null, 2));
      const data = loadData();
      const prev = data[cat] || {};
      const dishes = prev.dishes?.length === SLOTS ? prev.dishes : blankDishes();
      data[cat] = { count, fps, width, version: Date.now(), dishes };
      saveData(data);
      encodeVideo(req.file.path, cat, err => {
        fs.unlink(req.file.path, () => {});
        if (err) console.error('video encode failed:', err.message);
        res.json({ success: true, count, fps, width, video: !err });
      });
    });
  });
});

// Save exactly 5 dishes: [{name, price, url, description}]. Start times are automatic (0,20,40,60,80%).
app.post('/api/dishes/:cat', (req, res) => {
  const cat = req.params.cat;
  if (!validCat(cat)) return res.status(404).json({ error: 'Unknown category.' });
  const list = Array.isArray(req.body.dishes) ? req.body.dishes : [];
  const dishes = Array.from({ length: SLOTS }, (_, i) => {
    const d = list[i] || {};
    let url = String(d.url || '').trim().slice(0, 500);
    if (url && !/^https?:\/\//i.test(url)) url = 'https://' + url;
    return {
      name: String(d.name || `Dish ${i + 1}`).slice(0, 80),
      price: String(d.price || '').slice(0, 20),
      url,
      description: String(d.description || '').slice(0, 400),
      start: i * SLOT_PCT
    };
  });
  const data = loadData();
  data[cat] = { ...(data[cat] || { count: 0 }), dishes };
  saveData(data);
  res.json({ success: true, dishes });
});

app.use((err, req, res, next) => { console.error(err); res.status(500).json({ error: err.message || 'Server error.' }); });

app.listen(PORT, () => {
  console.log(`Menu:  http://localhost:${PORT}/`);
  console.log(`Admin: http://localhost:${PORT}/admin.html`);
});
