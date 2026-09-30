// General-purpose upscaler following the AMD FidelityFX FSR 1 algorithm (MIT):
// EASU = edge-adaptive 12-tap Lanczos-like upscale, RCAS = contrast-adaptive sharpen.
// Own WGSL implementation; works in display (gamma) space like FSR 1 expects.
const FSR_WGSL = `
@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var dst: texture_storage_2d<rgba16float, write>;

const SHARPNESS = 0.87; // exp2(-0.2 stops)

fn ld(p: vec2i) -> vec3f {
  return textureLoad(src, clamp(p, vec2i(0), vec2i(textureDimensions(src)) - 1), 0).rgb;
}
fn luma(c: vec3f) -> f32 { return c.r * 0.5 + c.g + c.b * 0.5; }

// Gradient between neighbours a and b around center c: (signed direction, edge strength).
fn edge(a: f32, c: f32, b: f32) -> vec2f {
  let d = b - a;
  let s = saturate(abs(d) / max(max(abs(c - a), abs(c - b)), 1e-5));
  return vec2f(d, s * s);
}
// Direction + strength at one of the 4 center texels, bilinear-weighted by w.
fn analyze(w: f32, up: f32, left: f32, c: f32, right: f32, down: f32) -> vec3f {
  let x = edge(left, c, right);
  let y = edge(up, c, down);
  return vec3f(x.x, y.x, x.y + y.y) * w;
}
// Lanczos2-like windowed weight for a tap at offset 'off', stretched along the edge.
fn weight(off: vec2f, dir: vec2f, len2: vec2f, lob: f32, clp: f32) -> f32 {
  let v = vec2f(dot(off, dir), dot(off, vec2f(-dir.y, dir.x))) * len2;
  let d2 = min(dot(v, v), clp);
  var wb = 0.4 * d2 - 1.0;
  var wa = lob * d2 - 1.0;
  wb *= wb;
  wa *= wa;
  return (1.5625 * wb - 0.5625) * wa;
}

@compute @workgroup_size(8, 8)
fn easu(@builtin(global_invocation_id) id: vec3u) {
  let outSize = textureDimensions(dst);
  if (any(id.xy >= outSize)) { return; }
  let pp = (vec2f(id.xy) + 0.5) * vec2f(textureDimensions(src)) / vec2f(outSize) - 0.5;
  let fp = floor(pp);
  let f = pp - fp;
  let o = vec2i(fp);

  //     b c
  //   e F G h      F G / J K are the 4 texels around the sample point
  //   i J K l
  //     n m
  var offs = array(
    vec2i(0, -1), vec2i(1, -1),
    vec2i(-1, 0), vec2i(0, 0), vec2i(1, 0), vec2i(2, 0),
    vec2i(-1, 1), vec2i(0, 1), vec2i(1, 1), vec2i(2, 1),
    vec2i(0, 2), vec2i(1, 2));
  var col: array<vec3f, 12>;
  var lum: array<f32, 12>;
  for (var t = 0; t < 12; t++) {
    col[t] = ld(o + offs[t]);
    lum[t] = luma(col[t]);
  }
  // indices: b0 c1 e2 F3 G4 h5 i6 J7 K8 l9 n10 m11
  let a = analyze((1.0 - f.x) * (1.0 - f.y), lum[0], lum[2], lum[3], lum[4], lum[7])
        + analyze(f.x * (1.0 - f.y), lum[1], lum[3], lum[4], lum[5], lum[8])
        + analyze((1.0 - f.x) * f.y, lum[3], lum[6], lum[7], lum[8], lum[10])
        + analyze(f.x * f.y, lum[4], lum[7], lum[8], lum[9], lum[11]);

  var dir = a.xy;
  let dd = dot(dir, dir);
  dir = select(dir * inverseSqrt(dd), vec2f(1.0, 0.0), dd < 1.0 / 32768.0);
  var len = a.z * 0.5;
  len *= len;
  let stretch = 1.0 / max(abs(dir.x), abs(dir.y));
  let len2 = vec2f(1.0 + (stretch - 1.0) * len, 1.0 - 0.5 * len);
  let lob = 0.5 - 0.29 * len;
  let clp = 1.0 / lob;

  var acc = vec3f(0.0);
  var wsum = 0.0;
  for (var t = 0; t < 12; t++) {
    let w = weight(vec2f(offs[t]) - f, dir, len2, lob, clp);
    acc += col[t] * w;
    wsum += w;
  }
  // Clamp to the 4 nearest texels to prevent ringing.
  let lo = min(min(col[3], col[4]), min(col[7], col[8]));
  let hi = max(max(col[3], col[4]), max(col[7], col[8]));
  textureStore(dst, id.xy, vec4f(clamp(acc / wsum, lo, hi), 1.0));
}

@compute @workgroup_size(8, 8)
fn rcas(@builtin(global_invocation_id) id: vec3u) {
  if (any(id.xy >= textureDimensions(dst))) { return; }
  let p = vec2i(id.xy);
  let b = ld(p + vec2i(0, -1));
  let d = ld(p + vec2i(-1, 0));
  let e = ld(p);
  let f = ld(p + vec2i(1, 0));
  let h = ld(p + vec2i(0, 1));
  let mn = min(min(b, d), min(f, h));
  let mx = max(max(b, d), max(f, h));
  // Largest negative lobe that keeps the result inside [0, 1] for every channel.
  let hitMin = min(mn, e) / (4.0 * max(mx, e) + 1e-5);
  let hitMax = (1.0 - max(mx, e)) / min(4.0 * mn - 4.0, vec3f(-1e-5));
  let l = max(-hitMin, hitMax);
  let lobe = max(-0.1875, min(max(l.r, max(l.g, l.b)), 0.0)) * SHARPNESS;
  let c = (lobe * (b + d + f + h) + e) / (4.0 * lobe + 1.0);
  textureStore(dst, id.xy, vec4f(saturate(c), 1.0));
}`;

// Same shape as the Anime4K pipelines: pass(encoder), getOutputTexture(), pipelines (for cleanup).
function fsr(device, input, target) {
  const module = device.createShaderModule({ code: FSR_WGSL });
  const tex = () => device.createTexture({
    size: [target.width, target.height],
    format: 'rgba16float',
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING,
  });
  const mid = tex();
  const out = tex();
  const passes = [['easu', input, mid], ['rcas', mid, out]].map(([entryPoint, from, to]) => {
    const pipeline = device.createComputePipeline({ layout: 'auto', compute: { module, entryPoint } });
    const bind = device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: from.createView() }, { binding: 1, resource: to.createView() }],
    });
    return { pipeline, bind };
  });
  return {
    pipelines: [{ getOutputTexture: () => mid }],
    getOutputTexture: () => out,
    pass(enc) {
      const cp = enc.beginComputePass();
      for (const p of passes) {
        cp.setPipeline(p.pipeline);
        cp.setBindGroup(0, p.bind);
        cp.dispatchWorkgroups(Math.ceil(target.width / 8), Math.ceil(target.height / 8));
      }
      cp.end();
    },
  };
}
