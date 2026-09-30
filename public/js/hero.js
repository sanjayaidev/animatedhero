/* Scroll-scrubbed hero
 *
 * 1. Frame 1 is painted immediately (it is also a plain <img> in the HTML).
 * 2. The remaining frames load in the background, in order, a few at a time.
 * 3. Page scroll stays locked until every frame is ready, then unlocks and
 *    scrolling drives the animation.
 */
(() => {
  'use strict';

  /* ---------- Settings ---------- */
  const FRAME_URL = (n) => `/frames/frame_${String(n).padStart(4, '0')}.jpg`;
  const CONCURRENCY = 6;        // how many frames download at once
  const MAX_WAIT_MS = 20000;    // safety net: unlock scroll after this long even if frames are still loading
  const FADE = 0.04;            // scroll-progress width of each text fade
  const MAX_DPR = 2;            // cap canvas resolution on high-density screens

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const EASE = reduceMotion ? 1 : 0.14;   // 1 = jump straight to the frame, lower = smoother/laggier

  /* ---------- Elements ---------- */
  const root = document.documentElement;
  const hero = document.getElementById('hero');
  const stage = hero.querySelector('.hero-stage');
  const canvas = document.getElementById('hero-canvas');
  const ctx = canvas.getContext('2d', { alpha: false });
  const meterLabel = document.getElementById('meter-label');
  const meterFill = document.getElementById('meter-fill');

  const slides = [...hero.querySelectorAll('.hero-slide')].map((el) => ({
    el,
    start: parseFloat(el.dataset.start),
    end: parseFloat(el.dataset.end),
  }));

  /* ---------- State ---------- */
  let total = 0;            // frame count (from the server manifest)
  let done = 0;             // frames finished (loaded or given up on)
  const frames = [];        // decoded Image objects, by index
  let ready = false;        // true once scroll is unlocked
  let current = 0;          // frame position being shown (float, eased)
  let target = 0;           // frame position the scroll asks for
  let drawn = -1;           // last frame index painted
  let raf = 0;

  // Always start at the top: the hero must play from frame 1, and browsers
  // would otherwise restore a mid-page scroll position on refresh.
  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
  window.scrollTo(0, 0);

  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const smooth = (t) => t * t * (3 - 2 * t);

  /* ---------- Canvas ---------- */
  function resizeCanvas() {
    const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    const w = Math.round(stage.clientWidth * dpr);
    const h = Math.round(stage.clientHeight * dpr);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
      ctx.imageSmoothingQuality = 'high';
    }
    drawn = -1;
    render();
  }

  // "cover" fit: fill the stage, crop the overflow, keep the aspect ratio.
  function paint(img) {
    const cw = canvas.width, ch = canvas.height;
    const scale = Math.max(cw / img.naturalWidth, ch / img.naturalHeight);
    const dw = img.naturalWidth * scale;
    const dh = img.naturalHeight * scale;
    ctx.drawImage(img, (cw - dw) / 2, (ch - dh) / 2, dw, dh);
  }

  // Nearest loaded frame to `i` — only matters if the safety timeout fired
  // before every frame arrived.
  function frameNear(i) {
    if (frames[i]) return { img: frames[i], exact: true };
    for (let d = 1; d < total; d++) {
      if (frames[i - d]) return { img: frames[i - d], exact: false };
      if (frames[i + d]) return { img: frames[i + d], exact: false };
    }
    return null;
  }

  function render() {
    const i = clamp(Math.round(current), 0, Math.max(total - 1, 0));
    if (i === drawn) return;
    const hit = frameNear(i);
    if (!hit) return;
    paint(hit.img);
    if (hit.exact) drawn = i;
  }

  function tick() {
    raf = 0;
    const diff = target - current;
    current = Math.abs(diff) < 0.02 ? target : current + diff * EASE;
    render();
    if (current !== target) raf = requestAnimationFrame(tick);
  }

  function requestTick() {
    if (!raf) raf = requestAnimationFrame(tick);
  }

  /* ---------- Scroll → progress → frame + text ---------- */
  function getProgress() {
    const scrollable = hero.offsetHeight - stage.offsetHeight;
    if (scrollable <= 0) return 0;
    return clamp(-hero.getBoundingClientRect().top / scrollable, 0, 1);
  }

  function updateSlides(p) {
    for (const s of slides) {
      const fadeIn = smooth(clamp((p - (s.start - FADE)) / FADE, 0, 1));
      const fadeOut = smooth(clamp((p - s.end) / FADE, 0, 1));
      const o = fadeIn * (1 - fadeOut);
      s.el.style.opacity = o.toFixed(3);
      // Only the slide that's actually visible can be clicked or tabbed to
      // (matters for the button on the last slide).
      s.el.style.pointerEvents = o > 0.6 ? 'auto' : 'none';
      s.el.inert = o < 0.05;
      if (!reduceMotion) {
        const y = (1 - fadeIn) * 24 - fadeOut * 24;
        s.el.style.transform = `translate3d(0, ${y.toFixed(1)}px, 0)`;
      }
    }
  }

  function update() {
    const p = getProgress();
    if (ready) meterFill.style.transform = `scaleX(${p})`;
    updateSlides(p);
    target = total > 1 ? p * (total - 1) : 0;
    requestTick();
  }

  window.addEventListener('scroll', () => {
    if (!ready) return;
    update();
  }, { passive: true });

  window.addEventListener('resize', () => {
    resizeCanvas();
    if (ready) update();
  });

  /* ---------- Loading ---------- */
  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.decoding = 'async';
      img.onload = () => {
        // decode() warms the browser's decoded-image cache so the first
        // time a frame is drawn doesn't cause a hitch.
        (img.decode ? img.decode() : Promise.resolve()).catch(() => {}).then(() => resolve(img));
      };
      img.onerror = () => reject(new Error(`Failed to load ${src}`));
      img.src = src;
    });
  }

  const loadWithRetry = (src) => loadImage(src).catch(() => loadImage(src));

  function showLoading() {
    if (!total) return;
    const pct = Math.round((done / total) * 100);
    meterLabel.textContent = `Loading ${pct}%`;
    meterFill.style.transform = `scaleX(${done / total})`;
  }

  function unlock() {
    if (ready) return;
    ready = true;
    root.classList.remove('is-loading');
    meterLabel.textContent = 'Scroll';
    meterFill.style.transform = 'scaleX(0)';
    resizeCanvas();
    update();
  }

  // Frame 1: draw it straight away, without waiting for the manifest.
  const firstFrame = loadWithRetry(FRAME_URL(1)).then((img) => {
    frames[0] = img;
    done++;
    resizeCanvas();
    canvas.classList.add('is-ready');
    showLoading();
  }).catch(() => { done++; });

  async function preload() {
    const res = await fetch('/frames/manifest.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error('manifest request failed');
    total = (await res.json()).count || 0;

    if (total < 2) {                 // nothing to scrub: keep the static frame
      hero.classList.add('is-static');
      return;
    }
    showLoading();

    let next = 1;                    // frame 0 is handled above
    async function worker() {
      while (next < total) {
        const i = next++;
        try {
          frames[i] = await loadWithRetry(FRAME_URL(i + 1));
        } catch (err) {
          console.warn(err.message);   // a missing frame is skipped; nearest one is shown instead
        }
        done++;
        showLoading();
      }
    }
    const workers = Array.from({ length: CONCURRENCY }, worker);
    await Promise.all([firstFrame, ...workers]);
  }

  const timeout = new Promise((resolve) => setTimeout(resolve, MAX_WAIT_MS));

  // Show the first headline + frame right away, then unlock when loading finishes.
  updateSlides(0);
  Promise.race([preload(), timeout])
    .catch((err) => {
      console.error(err);
      hero.classList.add('is-static');
    })
    .finally(unlock);

  /* ---------- Shared with other sections (see sections.js) ---------- */
  window.ScrollScrub = {
    get total() { return total; },
    // Decoded frame image for index i (nearest loaded one if it's missing)
    frameAt(i) {
      const hit = frameNear(clamp(i, 0, Math.max(total - 1, 0)));
      return hit ? hit.img : null;
    },
  };

  /* ---------- While loading, ignore in-page anchor jumps ---------- */
  document.addEventListener('click', (e) => {
    if (!ready && e.target.closest('a[href^="#"]')) e.preventDefault();
  });

  /* ---------- Mobile menu ---------- */
  const toggle = document.querySelector('.nav-toggle');
  const nav = document.getElementById('site-nav');

  function setMenu(open) {
    nav.classList.toggle('is-open', open);
    toggle.setAttribute('aria-expanded', String(open));
  }

  toggle.addEventListener('click', () => setMenu(!nav.classList.contains('is-open')));
  nav.addEventListener('click', (e) => { if (e.target.closest('a')) setMenu(false); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') setMenu(false); });
})();
