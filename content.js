// Anime4K overlay: copies each video frame into WebGPU, runs an Anime4K pipeline,
// draws the result on a canvas placed exactly over the video.
const AUTO_TIERS = ['fast', 'balanced', 'ModeA']; // light -> heavy
let settings = { ...DEFAULTS };
chrome.storage.local.get(DEFAULTS).then((v) => { settings = v; });
let session = null;
let starting = false;
let devicePromise = null;

const WGSL = `
@group(0) @binding(0) var smp: sampler;
@group(0) @binding(1) var enhanced: texture_2d<f32>;
@group(0) @binding(2) var original: texture_2d<f32>;
@group(0) @binding(3) var<uniform> strength: f32;
struct V { @builtin(position) pos: vec4f, @location(0) uv: vec2f };
@vertex fn vs(@builtin(vertex_index) i: u32) -> V {
  var ps = array(vec2f(-1, -1), vec2f(3, -1), vec2f(-1, 3));
  let p = ps[i];
  return V(vec4f(p, 0, 1), p * vec2f(0.5, -0.5) + 0.5);
}
@fragment fn fs(v: V) -> @location(0) vec4f {
  let e = textureSample(enhanced, smp, v.uv).rgb;
  let o = textureSample(original, smp, v.uv).rgb;
  return vec4f(mix(o, e, strength), 1);
}`;

function toast(text) {
  const el = document.createElement('div');
  el.textContent = text;
  el.style.cssText = 'position:fixed;top:16px;left:16px;z-index:2147483647;padding:6px 12px;border-radius:6px;' +
    'background:rgba(0,0,0,.8);color:#fff;font:13px system-ui,sans-serif;pointer-events:none';
  (document.fullscreenElement || document.body).appendChild(el);
  setTimeout(() => el.remove(), 2000);
}

function pickVideo() {
  let best = null;
  let bestArea = 200 * 150; // ignore tiny/ad videos
  for (const v of document.querySelectorAll('video')) {
    const r = v.getBoundingClientRect();
    if (v.videoWidth && r.width * r.height > bestArea) [best, bestArea] = [v, r.width * r.height];
  }
  return best;
}

async function lib() {
  if (!window['anime4k-webgpu']) {
    const res = await chrome.runtime.sendMessage('load');
    if (res !== true) throw new Error(res);
  }
  return window['anime4k-webgpu'];
}

function getDevice() {
  if (!navigator.gpu) return Promise.reject(new Error('WebGPU not available in this browser'));
  devicePromise ??= navigator.gpu.requestAdapter()
    .then((a) => { if (!a) throw new Error('No WebGPU adapter'); return a.requestDevice(); })
    .catch((e) => { devicePromise = null; throw e; });
  return devicePromise;
}

function destroyAll(p) {
  if (Array.isArray(p?.pipelines)) p.pipelines.forEach(destroyAll);
  p?.getOutputTexture?.().destroy();
}

function chain(device, input, classes) {
  const pipelines = [];
  for (const C of classes) {
    const p = new C({ device, inputTexture: input });
    pipelines.push(p);
    input = p.getOutputTexture();
  }
  return { pipelines, pass: (enc) => pipelines.forEach((p) => p.pass(enc)), getOutputTexture: () => input };
}

// fast/balanced/upscale: optional restore + at most one x2 pass; the present shader scales the rest.
// Library presets (ModeA...) run up to two x2 passes plus downscale, which is much heavier.
function makePipeline(A, name, device, input, target) {
  if (name === 'fsr') return fsr(device, input, target);
  const custom = { fast: [A.CNNM, A.CNNx2M], balanced: [A.CNNVL, A.CNNx2VL], upscale: [null, A.CNNx2VL] }[name];
  if (custom) {
    const [restore, x2] = custom;
    const up = target.width > 1.2 * input.width && target.height > 1.2 * input.height;
    return chain(device, input, [A.ClampHighlights, restore, up && x2].filter(Boolean));
  }
  // Popup is loaded fresh from disk, page scripts only after an extension reload + page refresh.
  if (typeof A[name] !== 'function') throw new Error(`Unknown mode "${name}". Reload the extension and refresh this page.`);
  return new A[name]({
    device,
    inputTexture: input,
    nativeDimensions: { width: input.width, height: input.height },
    targetDimensions: target,
  });
}

const labelOf = (s) => (settings.mode === 'auto' ? 'Auto · ' + MODES[AUTO_TIERS[s.tier]] : MODES[settings.mode]);

async function start(video) {
  const A = await lib();
  const device = await getDevice();
  const format = navigator.gpu.getPreferredCanvasFormat();
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'position:absolute;pointer-events:none;margin:0;padding:0;border:0;visibility:hidden';
  canvas.style.zIndex = getComputedStyle(video).zIndex;
  video.after(canvas);
  const ctx = canvas.getContext('webgpu');
  ctx.configure({ device, format, alphaMode: 'premultiplied' });
  const module = device.createShaderModule({ code: WGSL });
  const present = device.createRenderPipeline({
    layout: 'auto',
    vertex: { module, entryPoint: 'vs' },
    fragment: { module, entryPoint: 'fs', targets: [{ format }] },
  });
  const sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
  const strengthBuf = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const s = {
    video, canvas, input: null, pipe: null, bind: null, frame: 0, timer: 0,
    gen: 0, // bumps on every rebuild so stale GPU callbacks are ignored
    tier: 0, capped: AUTO_TIERS.length, // auto: current tier, lowest tier known to be too heavy
    gpu: 0, samples: 0, interval: 1000 / 24, lastMedia: 0, changed: 0,
  };

  s.setStrength = () => device.queue.writeBuffer(strengthBuf, 0, new Float32Array([settings.strength]));
  s.setStrength();

  s.build = () => {
    destroyAll(s.pipe);
    s.input?.destroy();
    canvas.width = s.pw;
    canvas.height = s.ph;
    s.input = device.createTexture({
      size: [video.videoWidth, video.videoHeight],
      format: 'rgba16float',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
    });
    const name = settings.mode === 'auto' ? AUTO_TIERS[s.tier] : settings.mode;
    s.pipe = makePipeline(A, name, device, s.input, { width: s.pw, height: s.ph });
    s.bind = device.createBindGroup({
      layout: present.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: sampler },
        { binding: 1, resource: s.pipe.getOutputTexture().createView() },
        { binding: 2, resource: s.input.createView() },
        { binding: 3, resource: { buffer: strengthBuf } },
      ],
    });
    // Hide until the new shaders have compiled and run a few frames: the original video shows
    // meanwhile instead of a stutter.
    s.gen++;
    s.gpu = 0;
    s.samples = 0;
    s.changed = performance.now();
    canvas.style.visibility = 'hidden';
    if (video.readyState >= 2) s.draw();
  };

  // ponytail: assumes object-fit: contain (the default); "cover"/transformed players will misalign.
  s.layout = () => {
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    const bw = video.clientWidth;
    const bh = video.clientHeight;
    const k = Math.min(bw / vw, bh / vh);
    const w = vw * k;
    const h = vh * k;
    Object.assign(canvas.style, {
      left: video.offsetLeft + video.clientLeft + (bw - w) / 2 + 'px',
      top: video.offsetTop + video.clientTop + (bh - h) / 2 + 'px',
      width: w + 'px',
      height: h + 'px',
    });
    s.pw = Math.max(1, Math.round(w * devicePixelRatio));
    s.ph = Math.max(1, Math.round(h * devicePixelRatio));
    clearTimeout(s.timer);
    if (!s.pipe) s.build();
    else if (s.pw !== canvas.width || s.ph !== canvas.height) s.timer = setTimeout(s.build, 150);
  };

  s.draw = () => {
    device.queue.copyExternalImageToTexture({ source: video }, { texture: s.input }, [s.input.width, s.input.height]);
    const enc = device.createCommandEncoder();
    s.pipe.pass(enc);
    const pass = enc.beginRenderPass({
      colorAttachments: [{
        view: ctx.getCurrentTexture().createView(), loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1],
      }],
    });
    pass.setPipeline(present);
    pass.setBindGroup(0, s.bind);
    pass.draw(3);
    pass.end();
    const gen = s.gen;
    const t0 = performance.now();
    device.queue.submit([enc.finish()]);
    device.queue.onSubmittedWorkDone().then(() => {
      if (gen !== s.gen) return;
      const ms = performance.now() - t0;
      s.samples++;
      if (s.samples >= (video.paused ? 1 : 3)) canvas.style.visibility = '';
      if (s.samples > 3) s.gpu = s.gpu ? s.gpu * 0.9 + ms * 0.1 : ms; // skip warm-up frames
    });
  };

  // Auto: keep GPU time per frame well under the video's frame interval so frames never pile up.
  s.autoTune = () => {
    if (settings.mode !== 'auto' || s.samples < 30 || performance.now() - s.changed < 2000) return;
    const load = s.gpu / s.interval;
    if (load > 0.5 && s.tier > 0) {
      s.capped = s.tier--;
      s.build();
    } else if (load < 0.2 && s.tier + 1 < s.capped) {
      s.tier++;
      s.build();
    }
  };

  const loop = (now, meta) => {
    if (session !== s) return;
    if (!video.isConnected) return stop();
    if (meta) {
      const dt = ((meta.mediaTime - s.lastMedia) * 1000) / (video.playbackRate || 1);
      if (dt > 5 && dt < 100) s.interval = s.interval * 0.9 + dt * 0.1;
      s.lastMedia = meta.mediaTime;
    }
    try {
      if (video.videoWidth !== s.input.width || video.videoHeight !== s.input.height) {
        s.layout();
        clearTimeout(s.timer);
        s.build();
      }
      s.draw();
      s.autoTune();
    } catch (e) {
      stop();
      toast(e.name === 'SecurityError' ? 'Anime4K blocked: video is cross-origin (no CORS)' : 'Anime4K error: ' + e.message);
      return;
    }
    s.frame = video.requestVideoFrameCallback(loop);
  };

  s.ro = new ResizeObserver(s.layout);
  s.ro.observe(video);
  document.addEventListener('fullscreenchange', s.layout);
  session = s;
  s.layout();
  loop();
}

function stop() {
  const s = session;
  if (!s) return;
  session = null;
  s.video.cancelVideoFrameCallback(s.frame);
  clearTimeout(s.timer);
  s.ro.disconnect();
  document.removeEventListener('fullscreenchange', s.layout);
  s.canvas.remove();
  destroyAll(s.pipe);
  s.input?.destroy();
}

chrome.storage.onChanged.addListener((changes) => {
  for (const k in changes) settings[k] = changes[k].newValue;
  if (!session) return;
  if (changes.strength) session.setStrength();
  if (changes.mode) {
    session.tier = 0;
    session.capped = AUTO_TIERS.length;
    session.build();
    toast(labelOf(session));
  }
});

// Sent to every frame of the tab; only the frame that has a video/session replies.
chrome.runtime.onMessage.addListener((cmd, _sender, reply) => {
  if (cmd === 'status') {
    if (!session) return;
    reply({ label: labelOf(session), gpu: session.gpu.toFixed(1), frame: session.interval.toFixed(1) });
  } else if (cmd === 'next-mode') {
    if (!session) return;
    const keys = Object.keys(MODES);
    chrome.storage.local.set({ mode: keys[(keys.indexOf(settings.mode) + 1) % keys.length] });
  } else if (cmd === 'toggle') {
    if (session) {
      stop();
      toast('Anime4K off');
      return reply(false);
    }
    const video = pickVideo();
    if (!video || starting) return;
    starting = true;
    start(video)
      .then(() => { if (session) toast(labelOf(session)); reply(!!session); })
      .catch((e) => { stop(); toast('Anime4K error: ' + e.message); reply(e.message); })
      .finally(() => { starting = false; });
    return true;
  }
});
