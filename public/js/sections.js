/* Sections below the hero
 *
 * - Reveal on scroll
 * - One shared rule for every interaction: MOUSE = hover, TOUCH = tap,
 *   KEYBOARD = Enter/Space.
 * - Gallery, flip cards, scrolls, contact items, and the looping preview.
 */
(() => {
  'use strict';

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const smooth = (t) => t * t * (3 - 2 * t);
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ===================================================================
     Reveal on scroll
     =================================================================== */
  const revealEls = $$('.reveal');
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.isIntersecting) {
          e.target.classList.add('is-in');
          io.unobserve(e.target);
        }
      }
    }, { threshold: 0.12, rootMargin: '0px 0px -6% 0px' });
    revealEls.forEach((el) => io.observe(el));
  } else {
    revealEls.forEach((el) => el.classList.add('is-in'));
  }

  /* ===================================================================
     Hover on mouse, tap on touch
     -------------------------------------------------------------------
     bindToggle(el, { open, close, isOpen, isLink })
       mouse     → open on pointer enter, close on leave
       touch/pen → tap toggles (a link needs a second tap to be followed)
       keyboard  → Enter/Space toggles (a link is followed by Enter)
     =================================================================== */
  function bindToggle(el, { open, close, isOpen, isLink = false }) {
    let type = 'mouse';
    el.addEventListener('pointerdown', (e) => { type = e.pointerType || 'mouse'; });

    el.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') open(); });
    el.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') close(); });

    el.addEventListener('click', (e) => {
      const fromKeyboard = e.detail === 0;
      if (type === 'mouse' && !fromKeyboard) return;      // mouse: hover already did the work
      if (isLink) {
        if (fromKeyboard) return;                          // keyboard: follow the link
        if (!isOpen()) { e.preventDefault(); open(); }     // touch: first tap opens, second follows
        return;
      }
      isOpen() ? close() : open();
    });

    // Keyboard focus previews links (not touch taps, which also focus)
    if (isLink) {
      el.addEventListener('focusin', () => { if (el.matches(':focus-visible')) open(); });
      el.addEventListener('focusout', close);
    }
  }

  // Tapping anywhere else closes things that were opened by touch.
  function closeOnOutsideTouch(items, closeFn) {
    document.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse') return;
      items.forEach((it) => { if (!it.contains(e.target)) closeFn(it); });
    });
  }

  /* ===================================================================
     Gallery: big image + column of five (FLIP animation)
     =================================================================== */
  (function gallery() {
    const grid = $('#gallery-grid');
    if (!grid) return;
    const items = $$('.g-item', grid);
    let active = null;
    let pointer = { x: 0, y: 0 };
    let anchor = { x: 0, y: 0 };
    let pending = null;
    let timer = 0;

    // Animate every tile from its old position/size to its new one.
    function flip(change) {
      const first = items.map((el) => el.getBoundingClientRect());
      items.forEach((el) => el.getAnimations().forEach((a) => a.cancel()));
      change();
      if (reduceMotion) return;
      items.forEach((el, i) => {
        const f = first[i];
        const l = el.getBoundingClientRect();
        if (!l.width || !l.height) return;
        const dx = f.left - l.left;
        const dy = f.top - l.top;
        const sx = f.width / l.width;
        const sy = f.height / l.height;
        if (!dx && !dy && sx === 1 && sy === 1) return;
        el.animate(
          [{ transformOrigin: 'top left', transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})` },
           { transformOrigin: 'top left', transform: 'none' }],
          { duration: 560, easing: 'cubic-bezier(0.22, 0.8, 0.2, 1)' }
        );
      });
    }

    function setActive(item) {
      if (item === active) return;
      anchor = { ...pointer };
      flip(() => {
        active && active.classList.remove('is-active');
        active = item;
        if (item) item.classList.add('is-active');
        grid.classList.toggle('has-active', !!item);
        items.forEach((it) => it.setAttribute('aria-pressed', String(it === item)));
      });
    }

    // Mouse: hover picks the image. Once one is open, a *real* pointer
    // movement is needed to switch, otherwise the layout change itself
    // (which moves tiles under a still cursor) would cause flicker.
    grid.addEventListener('pointermove', (e) => {
      if (e.pointerType !== 'mouse') return;
      pointer = { x: e.clientX, y: e.clientY };
      const it = e.target.closest('.g-item');
      if (!it || it === active) { clearTimeout(timer); pending = null; return; }
      if (active && Math.hypot(pointer.x - anchor.x, pointer.y - anchor.y) < 14) return;
      if (pending !== it) {
        pending = it;
        clearTimeout(timer);
        timer = setTimeout(() => { if (pending === it) setActive(it); }, active ? 140 : 70);
      }
    });

    grid.addEventListener('pointerleave', (e) => {
      if (e.pointerType !== 'mouse') return;
      clearTimeout(timer);
      pending = null;
      setActive(null);
    });

    // Touch / pen / keyboard: tap a tile to open it, tap the big one to close.
    let lastType = 'mouse';
    grid.addEventListener('pointerdown', (e) => { lastType = e.pointerType; pointer = { x: e.clientX, y: e.clientY }; });
    grid.addEventListener('click', (e) => {
      const it = e.target.closest('.g-item');
      if (!it) return;
      const fromKeyboard = e.detail === 0;
      if (lastType === 'mouse' && !fromKeyboard) { setActive(it); return; }
      setActive(it === active ? null : it);
    });

    document.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'mouse' && !grid.contains(e.target)) setActive(null);
    });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') setActive(null); });
  })();

  /* ===================================================================
     Feature cards: 3D flip
     =================================================================== */
  $$('.flip').forEach((card) => {
    const set = (v) => { card.classList.toggle('is-flipped', v); card.setAttribute('aria-pressed', String(v)); };
    bindToggle(card, {
      open: () => set(true),
      close: () => set(false),
      isOpen: () => card.classList.contains('is-flipped'),
    });
  });

  /* ===================================================================
     Why us: scrolls that unroll
     =================================================================== */
  (function scrolls() {
    const items = $$('.parchment');
    const set = (el, v) => {
      el.classList.toggle('is-open', v);
      $('.paper-head', el).setAttribute('aria-expanded', String(v));
    };
    items.forEach((el) => bindToggle(el, {
      open: () => set(el, true),
      close: () => set(el, false),
      isOpen: () => el.classList.contains('is-open'),
    }));
  })();

  /* ===================================================================
     Contact: envelope, phone, globe
     =================================================================== */
  (function contact() {
    const items = $$('.c-item');
    if (!items.length) return;
    let globeApi = null;
    const globeItem = $('.c-globe');

    const set = (el, v) => {
      el.classList.toggle('is-open', v);
      if (el === globeItem && globeApi) globeApi.setOpen(v);
    };

    items.forEach((el) => bindToggle(el, {
      open: () => set(el, true),
      close: () => set(el, false),
      isOpen: () => el.classList.contains('is-open'),
      isLink: true,
    }));
    closeOnOutsideTouch(items, (el) => set(el, false));

    // Load the 3D globe only when the contact section is near, so its
    // ~500 KB of three.js never competes with the hero frames.
    if (globeItem && 'IntersectionObserver' in window) {
      const loader = new IntersectionObserver((entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        loader.disconnect();
        import('/js/globe.js')
          .then((m) => m.initGlobe($('.globe', globeItem), globeItem.dataset.url))
          .then((api) => {
            if (!api) return;
            globeApi = api;
            api.setOpen(globeItem.classList.contains('is-open'));
          })
          .catch((err) => console.warn('Globe unavailable:', err.message));
      }, { rootMargin: '900px 0px' });
      loader.observe($('#contact'));
    }
  })();

  /* ===================================================================
     Preview: laptop + phone play a looping copy of the hero
     =================================================================== */
  (function preview() {
    const root = $('#devices');
    if (!root) return;

    const FADE = 0.04;
    const LEG = 9000;     // ms to play the bloom forwards (and again backwards)
    const HOLD = 900;     // ms to pause at each end

    // Reuse the hero's own copy so the two never drift apart.
    const copy = $$('.hero-slide').map((s) => ({
      title: $('.hero-title', s).textContent,
      text: $('p', s).textContent,
      start: parseFloat(s.dataset.start),
      end: parseFloat(s.dataset.end),
    }));

    const screens = $$('.site-preview', root).map((el) => {
      const canvas = $('canvas', el);
      const slides = copy.map((c) => {
        const node = document.createElement('div');
        node.className = 'sp-slide';
        node.innerHTML = '<strong></strong><span></span>';
        $('strong', node).textContent = c.title;
        $('span', node).textContent = c.text;
        $('.sp-copy', el).appendChild(node);
        return { node, ...c };
      });
      return {
        el, canvas, slides,
        ctx: canvas.getContext('2d', { alpha: false }),
        thumb: $('.sp-scrollbar i', el),
        touch: $('.sp-touch', el),
        mobile: el.dataset.device === 'mobile',
        drawn: -1,
      };
    });

    const poster = $('.hero-poster');
    const frameFor = (i) => (window.ScrollScrub && window.ScrollScrub.frameAt(i)) || poster;

    function size(s) {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.round(s.el.clientWidth * dpr);
      const h = Math.round(s.el.clientHeight * dpr);
      if (s.canvas.width !== w || s.canvas.height !== h) {
        s.canvas.width = w;
        s.canvas.height = h;
        s.drawn = -1;
      }
    }

    function draw(s, img) {
      const cw = s.canvas.width, ch = s.canvas.height;
      const iw = img.naturalWidth, ih = img.naturalHeight;
      if (!iw || !ih) return;
      const k = Math.max(cw / iw, ch / ih);
      s.ctx.drawImage(img, (cw - iw * k) / 2, (ch - ih * k) / 2, iw * k, ih * k);
    }

    function show(p) {
      const total = (window.ScrollScrub && window.ScrollScrub.total) || 1;
      const idx = Math.round(p * (total - 1));
      for (const s of screens) {
        if (s.drawn !== idx) {
          const img = frameFor(idx);
          if (img) { draw(s, img); s.drawn = idx; }
        }
        for (const sl of s.slides) {
          const fin = smooth(clamp((p - (sl.start - FADE)) / FADE, 0, 1));
          const fout = smooth(clamp((p - sl.end) / FADE, 0, 1));
          sl.node.style.opacity = (fin * (1 - fout)).toFixed(3);
          sl.node.style.transform = `translateY(${((1 - fin) * 14 - fout * 14).toFixed(1)}px)`;
        }
        if (s.thumb) s.thumb.style.top = `${p * 84}%`;
        if (s.touch) s.touch.style.transform = `translateY(${(-p * 42).toFixed(1)}cqw) scale(${p > 0 && p < 1 ? 0.92 : 1})`;
      }
    }

    // Forwards, pause, backwards, pause.
    const CYCLE = (LEG + HOLD) * 2;
    function progressAt(t) {
      const m = t % CYCLE;
      if (m < LEG) return smooth(m / LEG) * 0.5 + (m / LEG) * 0.5;
      if (m < LEG + HOLD) return 1;
      if (m < LEG * 2 + HOLD) { const x = (m - LEG - HOLD) / LEG; return 1 - (smooth(x) * 0.5 + x * 0.5); }
      return 0;
    }

    let visible = false, raf = 0, t0 = 0;
    function loop(now) {
      raf = 0;
      if (!visible || document.hidden) return;
      show(progressAt(now - t0));
      raf = requestAnimationFrame(loop);
    }
    function start() {
      if (raf) return;
      t0 = performance.now();
      raf = requestAnimationFrame(loop);
    }

    function resizeAll() { screens.forEach(size); if (!visible || reduceMotion) show(0); }
    if ('ResizeObserver' in window) new ResizeObserver(resizeAll).observe(root); else window.addEventListener('resize', resizeAll);
    resizeAll();
    show(0);

    if (!reduceMotion && 'IntersectionObserver' in window) {
      new IntersectionObserver(([e]) => { visible = e.isIntersecting; if (visible) start(); }, { threshold: 0.15 }).observe(root);
      document.addEventListener('visibilitychange', () => { if (!document.hidden && visible) start(); });
    }
  })();

  /* ===================================================================
     How it works: the line draws down the page as you scroll
     =================================================================== */
  (function how() {
    const wrap = $('#steps');
    if (!wrap) return;
    const line = $('.steps-line', wrap);
    const fill = $('i', line);
    const dots = $$('.step-dot', wrap);
    const steps = $$('.step', wrap);
    const READ_AT = 0.62;      // how far down the screen the "reading line" sits
    let queued = false;

    // Stretch the line from the first dot to the last dot.
    function measure() {
      const w = wrap.getBoundingClientRect();
      const a = dots[0].getBoundingClientRect();
      const z = dots[dots.length - 1].getBoundingClientRect();
      const top = a.top + a.height / 2 - w.top;
      line.style.top = `${top}px`;
      line.style.height = `${z.top + z.height / 2 - w.top - top}px`;
    }

    function update() {
      queued = false;
      const y = window.innerHeight * READ_AT;
      const l = line.getBoundingClientRect();
      fill.style.transform = `scaleY(${clamp((y - l.top) / (l.height || 1), 0, 1)})`;
      dots.forEach((d, i) => {
        const r = d.getBoundingClientRect();
        steps[i].classList.toggle('is-on', y >= r.top + r.height / 2 - 2);
      });
    }
    const queue = () => { if (!queued) { queued = true; requestAnimationFrame(update); } };

    window.addEventListener('scroll', queue, { passive: true });
    window.addEventListener('resize', () => { measure(); queue(); });
    window.addEventListener('load', () => { measure(); queue(); });
    if ('ResizeObserver' in window) new ResizeObserver(() => { measure(); queue(); }).observe(wrap);
    measure();
    update();
  })();

  /* ===================================================================
     Pricing: price counts up; "ask for a quote" pre-selects the form topic
     =================================================================== */
  (function pricing() {
    const num = $('.price-num');
    if (num && !reduceMotion && 'IntersectionObserver' in window) {
      const target = parseInt(num.dataset.count, 10);
      const fmt = new Intl.NumberFormat('en-IN');
      num.textContent = '0';
      const io = new IntersectionObserver(([e]) => {
        if (!e.isIntersecting) return;
        io.disconnect();
        const t0 = performance.now();
        const DURATION = 1600;
        (function step(now) {
          const k = clamp((now - t0) / DURATION, 0, 1);
          num.textContent = fmt.format(Math.round(target * (1 - Math.pow(1 - k, 3))));
          if (k < 1) requestAnimationFrame(step);
        })(t0);
      }, { threshold: 0.6 });
      io.observe(num);
    }

    $$('[data-topic]').forEach((a) => a.addEventListener('click', () => {
      const select = $('#f-topic');
      if (select) select.value = a.dataset.topic;
    }));
  })();

  /* ===================================================================
     FAQ: one answer open at a time
     =================================================================== */
  (function faq() {
    const items = $$('.faq-item');
    items.forEach((item) => {
      $('.faq-q', item).addEventListener('click', () => {
        const willOpen = !item.classList.contains('is-open');
        items.forEach((it) => {
          const open = it === item && willOpen;
          it.classList.toggle('is-open', open);
          $('.faq-q', it).setAttribute('aria-expanded', String(open));
        });
      });
    });
  })();

  /* ===================================================================
     Contact form
     -------------------------------------------------------------------
     Messages are delivered to graphicyin@gmail.com through FormSubmit
     (formsubmit.co), which needs no server code. The very first message
     makes FormSubmit email you an "Activate" link; click it once and every
     later message arrives normally.
     =================================================================== */
  (function form() {
    const EMAIL = 'graphicyin@gmail.com';
    const ENDPOINT = `https://formsubmit.co/ajax/${EMAIL}`;

    const formEl = $('#contact-form');
    if (!formEl) return;
    const btn = $('.send', formEl);
    const label = $('.send-label', btn);
    const status = $('#form-status');
    const fields = { name: $('#f-name'), email: $('#f-email'), message: $('#f-message') };
    const topic = $('#f-topic');
    const LABELS = { idle: 'Send message', sending: 'Sending…', sent: 'Message sent', error: 'Try again' };

    function setState(state) {
      btn.dataset.state = state;
      label.textContent = LABELS[state];
      btn.disabled = state === 'sending';
    }

    function showError(key, message) {
      const field = fields[key].closest('.field');
      field.classList.toggle('has-error', !!message);
      $(`#e-${key}`).textContent = message || '';
      fields[key].setAttribute('aria-invalid', message ? 'true' : 'false');
    }

    function validate() {
      const name = fields.name.value.trim();
      const email = fields.email.value.trim();
      const message = fields.message.value.trim();
      const problems = {
        name: name ? '' : 'Please tell us your name.',
        email: !email ? 'Please enter your email.'
          : /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) ? '' : "That email doesn't look right.",
        message: message.length >= 10 ? '' : 'Please add a few words about your project.',
      };
      let first = null;
      for (const key of Object.keys(problems)) {
        showError(key, problems[key]);
        if (problems[key] && !first) first = fields[key];
      }
      if (first) first.focus();
      return !first;
    }

    // Editing after an error/success returns everything to normal.
    formEl.addEventListener('input', (e) => {
      const key = Object.keys(fields).find((k) => fields[k] === e.target);
      if (key) showError(key, '');
      if (btn.dataset.state === 'sent' || btn.dataset.state === 'error') {
        setState('idle');
        status.textContent = '';
        status.className = 'form-status';
      }
    });

    formEl.addEventListener('submit', async (e) => {
      e.preventDefault();
      status.textContent = '';
      status.className = 'form-status';
      if (!validate()) return;

      const data = {
        name: fields.name.value.trim(),
        email: fields.email.value.trim(),
        topic: topic.value,
        message: fields.message.value.trim(),
      };

      if ($('.hp', formEl).value) { setState('sent'); return; }   // a bot filled the hidden field

      setState('sending');
      try {
        const res = await fetch(ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({
            ...data,
            _subject: `New enquiry: ${data.topic}`,
            _replyto: data.email,
            _template: 'table',
            _captcha: 'false',
          }),
        });
        const reply = await res.json().catch(() => ({}));
        if (!res.ok || String(reply.success) === 'false') throw new Error(reply.message || 'Request failed');

        setState('sent');
        status.textContent = "Thanks! Your message is on its way. We'll be in touch soon.";
        status.classList.add('is-ok');
        formEl.reset();
      } catch (err) {
        const body = `Name: ${data.name}\nEmail: ${data.email}\nInterested in: ${data.topic}\n\n${data.message}`;
        const href = `mailto:${EMAIL}?subject=${encodeURIComponent(`New enquiry: ${data.topic}`)}&body=${encodeURIComponent(body)}`;
        setState('error');
        status.classList.add('is-err');
        status.innerHTML = `We couldn't send that just now. <a href="${href}">Email us directly instead</a>.`;
      }
    });
  })();

  /* ===================================================================
     Final CTA: petals, and a button that leans toward the cursor
     =================================================================== */
  (function cta() {
    const section = $('#start');
    if (!section) return;

    const box = $('#cta-petals');
    if (box && !reduceMotion) {
      // Small seeded random so the petals look the same on every visit.
      let seed = 7;
      const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
      const count = window.innerWidth < 600 ? 9 : 16;
      for (let i = 0; i < count; i++) {
        const petal = document.createElement('i');
        petal.style.setProperty('--x', `${(rnd() * 100).toFixed(1)}%`);
        petal.style.setProperty('--s', `${(10 + rnd() * 16).toFixed(0)}px`);
        petal.style.setProperty('--d', `${(9 + rnd() * 9).toFixed(1)}s`);
        petal.style.setProperty('--delay', `${(-rnd() * 18).toFixed(1)}s`);   // negative: starts mid-fall
        petal.style.setProperty('--drift', `${((rnd() - 0.5) * 160).toFixed(0)}px`);
        box.appendChild(petal);
      }
    }

    // Animations only run while the section is on screen.
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(([e]) => section.classList.toggle('is-active', e.isIntersecting)).observe(section);
    } else {
      section.classList.add('is-active');
    }

    const magnet = $('.btn-magnetic', section);
    if (magnet && !reduceMotion) {
      magnet.addEventListener('pointermove', (e) => {
        if (e.pointerType !== 'mouse') return;
        const r = magnet.getBoundingClientRect();
        const x = (e.clientX - (r.left + r.width / 2)) / r.width;
        const y = (e.clientY - (r.top + r.height / 2)) / r.height;
        magnet.style.transform = `translate(${(x * 16).toFixed(1)}px, ${(y * 10).toFixed(1)}px)`;
      });
      magnet.addEventListener('pointerleave', () => { magnet.style.transform = ''; });
    }
  })();
})();
