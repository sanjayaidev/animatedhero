/* 3D earth for the contact section.
 *
 * The globe rests facing India. On hover (or tap) it turns half a revolution
 * to show the website address carved into the far side. The lettering is
 * painted into both the colour map and the bump map, so the light catches
 * it like a real engraving.
 *
 * Loaded on demand by sections.js. Returns null if WebGL isn't available,
 * in which case the CSS fallback in the page is used.
 */
import {
  WebGLRenderer, Scene, PerspectiveCamera, SphereGeometry, Mesh,
  MeshStandardMaterial, AmbientLight, DirectionalLight, CanvasTexture,
  SRGBColorSpace,
} from '/vendor/three.min.js';

const FRONT_LON = 78;            // longitude facing you at rest (India)
const TILT = 0.28;               // radians the north pole leans toward the camera
const TEXT_SPAN_DEG = 104;       // how many degrees of longitude the lettering covers
const TURN_SECONDS = 1.5;

const smooth = (t) => t * t * (3 - 2 * t);

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Could not load ${src}`));
    img.src = src;
  });
}

// Paints the address into the colour + bump canvases at the far side.
function carve(colorCtx, bumpCtx, W, H, text) {
  const backLon = FRONT_LON - 180;                       // longitude that faces you after the turn
  const cx = ((backLon + 180) / 360) * W;
  const cy = (0.5 - (TILT * 180 / Math.PI) / 180) * H;   // the latitude the tilt brings to the centre

  const family = '"Fraunces", Georgia, "Times New Roman", serif';
  colorCtx.font = `400 100px ${family}`;
  const fontSize = 100 * ((TEXT_SPAN_DEG / 360) * W) / colorCtx.measureText(text).width;
  const font = `400 ${fontSize}px ${family}`;

  for (const ctx of [colorCtx, bumpCtx]) {
    ctx.font = font;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
  }

  // Colour: pale ridge on the lower edge, dark recess on top.
  colorCtx.fillStyle = 'rgba(255, 255, 255, 0.72)';
  colorCtx.fillText(text, cx + 3, cy + 3);
  colorCtx.fillStyle = 'rgba(6, 18, 36, 0.88)';
  colorCtx.fillText(text, cx, cy);

  // Bump: black = cut deep into the surface.
  bumpCtx.shadowColor = '#000';
  bumpCtx.shadowBlur = fontSize * 0.09;
  bumpCtx.fillStyle = '#000';
  bumpCtx.fillText(text, cx, cy);
  bumpCtx.fillText(text, cx, cy);
}

export async function initGlobe(host, text) {
  const mount = host.querySelector('.globe-canvas');
  if (!mount) return null;

  let renderer;
  try {
    renderer = new WebGLRenderer({ antialias: true, alpha: true });
    if (!renderer.getContext()) return null;
  } catch {
    return null;
  }

  const [earth, bump] = await Promise.all([loadImage('/img/earth.jpg'), loadImage('/img/earth-bump.jpg')]);
  try { await document.fonts.load('400 100px "Fraunces"'); } catch { /* falls back to Georgia */ }

  const W = Math.min(3072, renderer.capabilities.maxTextureSize);
  const H = W / 2;

  const colorCanvas = document.createElement('canvas');
  const bumpCanvas = document.createElement('canvas');
  colorCanvas.width = bumpCanvas.width = W;
  colorCanvas.height = bumpCanvas.height = H;
  const cctx = colorCanvas.getContext('2d');
  const bctx = bumpCanvas.getContext('2d');
  cctx.drawImage(earth, 0, 0, W, H);
  bctx.drawImage(bump, 0, 0, W, H);
  carve(cctx, bctx, W, H, text);

  const map = new CanvasTexture(colorCanvas);
  map.colorSpace = SRGBColorSpace;
  map.anisotropy = renderer.capabilities.getMaxAnisotropy();
  const bumpMap = new CanvasTexture(bumpCanvas);

  const scene = new Scene();
  const camera = new PerspectiveCamera(30, 1, 0.1, 20);
  camera.position.z = 4;

  const globe = new Mesh(
    new SphereGeometry(1, 128, 96),
    new MeshStandardMaterial({ map, bumpMap, bumpScale: 4, roughness: 0.88, metalness: 0 })
  );
  scene.add(globe);
  scene.add(new AmbientLight(0xffffff, 0.75));
  const sun = new DirectionalLight(0xffffff, 2.3);
  sun.position.set(-2.5, 2, 4);
  scene.add(sun);

  // Which way to turn the sphere so a given longitude faces the camera.
  const phi = ((FRONT_LON + 180) / 360) * Math.PI * 2;
  const yawFront = Math.PI / 2 - phi;

  // ----- animation -----
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let progress = 0;      // 0 = facing you, 1 = far side
  let target = 0;
  let last = 0;
  let raf = 0;

  function draw() {
    globe.rotation.set(TILT, yawFront + smooth(progress) * Math.PI, 0);
    renderer.render(scene, camera);
  }

  function frame(now) {
    raf = 0;
    const dt = Math.max(0, Math.min((now - last) / 1000, 0.1));   // never negative: first rAF timestamp can precede `last`
    const step = dt / TURN_SECONDS;
    last = now;
    progress += Math.max(-step, Math.min(step, target - progress));
    draw();
    if (progress !== target) raf = requestAnimationFrame(frame);
  }

  function setOpen(open) {
    target = open ? 1 : 0;
    if (reduce) { progress = target; draw(); return; }
    if (!raf) { last = performance.now(); raf = requestAnimationFrame(frame); }
  }

  // ----- sizing -----
  function resize() {
    const size = Math.max(1, Math.round(host.clientWidth));
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(size, size, false);
    draw();
  }

  mount.appendChild(renderer.domElement);
  resize();
  host.classList.add('has-gl');                 // hides the CSS fallback
  if ('ResizeObserver' in window) new ResizeObserver(resize).observe(host);

  return { setOpen };
}
