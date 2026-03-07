// Balatro-style card hover tilt using W-component perspective warp + juice.
//
// Ported from Balatro source:
//   Shader:  resources/shaders/dissolve.fs / skew.fs (W-offset vertex warp)
//   Juice:   engine/moveable.lua  juice_up() / move_juice()
//   Easing:  game.lua  exp_times  (velocity-based exponential smoothing)
//   Hover:   card.lua  Card:hover() → juice_up(0.05, 0.03), hover_tilt = 1

const VERT = [
  "precision mediump float;",
  "attribute vec2 a_pos;",
  "varying vec2 v_uv;",
  "uniform vec2 u_mouse;",
  "uniform float u_hover;",
  "uniform vec2 u_scale;",
  "uniform float u_juice_s;",
  "uniform float u_juice_r;",
  "void main() {",
  "  v_uv = a_pos * 0.5 + 0.5;",
  "  v_uv.y = 1.0 - v_uv.y;",
  // Scale: base + hover zoom (+5%) + juice oscillation
  "  vec2 pos = a_pos * u_scale * (1.0 + 0.05 * u_hover + u_juice_s);",
  // Juice rotation (in-plane wobble)
  "  float cr = cos(u_juice_r); float sr = sin(u_juice_r);",
  "  pos = vec2(cr * pos.x - sr * pos.y, sr * pos.x + cr * pos.y);",
  // Perspective warp via W (dissolve.fs / skew.fs)
  "  float mid = length(a_pos) * 0.35;",
  "  vec2 moff = a_pos - u_mouse;",
  "  float off2 = dot(moff, moff);",
  "  float w = max(0.5, 1.0 + 0.7 * (-0.03 - 0.3 * max(0.0, 0.3 - mid))",
  "            * u_hover * off2 / (2.0 - mid));",
  "  gl_Position = vec4(pos, 0.0, w);",
  "}",
].join("\n");

const FRAG = [
  "precision mediump float;",
  "varying vec2 v_uv;",
  "uniform sampler2D u_tex;",
  "uniform vec2 u_mouse;",
  "uniform float u_hover;",
  "void main() {",
  "  vec4 c = texture2D(u_tex, v_uv);",
  "  vec2 lp = vec2(0.5 + u_mouse.x * 0.5, 0.5 - u_mouse.y * 0.5);",
  "  float d = distance(v_uv, lp);",
  "  float spec = smoothstep(0.5, 0.0, d) * 0.08 * u_hover;",
  "  gl_FragColor = vec4(c.rgb + spec, c.a);",
  "}",
].join("\n");

const PAD = 24;

// ── Balatro constants ──────────────────────────────────────────────
// game.lua:  G.exp_times.scale = math.exp(-60*real_dt)
const EXP_SCALE_K = 40;
// game.lua:  G.exp_times.r = math.exp(-190*real_dt)
const EXP_R_K = 190;
// moveable.lua:  juice duration = 0.4s
const JUICE_DUR = 0.4;
// moveable.lua:  scale oscillation freq 50.8, rotation 40.8
const JUICE_SCALE_HZ = 50.8;
const JUICE_R_HZ = 40.8;

// ── GL state ───────────────────────────────────────────────────────
let canvas: HTMLCanvasElement | null = null;
let gl: WebGLRenderingContext | null = null;
let uMouse: WebGLUniformLocation | null = null;
let uHover: WebGLUniformLocation | null = null;
let uScale: WebGLUniformLocation | null = null;
let uJuiceS: WebGLUniformLocation | null = null;
let uJuiceR: WebGLUniformLocation | null = null;
let texCache = new Map<string, WebGLTexture>();

// ── Animation state ────────────────────────────────────────────────
let raf = 0;
let gen = 0;
let lastTime = 0;

// Mouse (tracked directly, no easing — Balatro does the same)
let mouseX = 0;
let mouseY = 0;

// Hover magnitude — velocity-based easing matching exp_times.scale
let hover = 0;
let hoverGoal = 0;
let hoverVel = 0;

// Juice — damped sinusoidal pop on hover start
// card.lua:  Card:juice_up(0.05, 0.03)
//   → Card override:  scale = 0.05*0.4 = 0.02,  rot = 0.4*±0.03 = ±0.012
//   → Moveable:  VT.scale = 1 - 0.6*amount  (initial pop-down)
// move_juice:  scale = amt * sin(50.8*t) * (remaining³)
//              r     = amt * sin(40.8*t) * (remaining²)
let juiceActive = false;
let juiceTime = 0;
let juiceScaleAmt = 0;
let juiceRAmt = 0;
let juiceS = 0; // current juice scale offset
let juiceR = 0; // current juice rotation (radians)
// Velocity-smoothed juice values (fed through exp_times easing)
let vtJuiceS = 0;
let vtJuiceSVel = 0;
let vtJuiceR = 0;
let vtJuiceRVel = 0;

let hiddenImg: HTMLElement | null = null;
let activeWrapper: HTMLElement | null = null;

function compile(type: number, src: string): WebGLShader | null {
  const s = gl!.createShader(type);
  if (!s) return null;
  gl!.shaderSource(s, src);
  gl!.compileShader(s);
  if (!gl!.getShaderParameter(s, gl!.COMPILE_STATUS)) {
    console.error("Shader error:", gl!.getShaderInfoLog(s));
    gl!.deleteShader(s);
    return null;
  }
  return s;
}

function init() {
  canvas = document.createElement("canvas");
  canvas.style.cssText =
    "position:absolute;pointer-events:none;z-index:9999;display:none;";

  gl = canvas.getContext("webgl", { alpha: true })!;
  if (!gl) return;

  const vs = compile(gl.VERTEX_SHADER, VERT);
  const fs = compile(gl.FRAGMENT_SHADER, FRAG);
  if (!vs || !fs) return;

  const prog = gl.createProgram()!;
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);

  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    console.error("Link error:", gl.getProgramInfoLog(prog));
    return;
  }

  gl.useProgram(prog);

  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
    gl.STATIC_DRAW,
  );

  const aPos = gl.getAttribLocation(prog, "a_pos");
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

  uMouse = gl.getUniformLocation(prog, "u_mouse");
  uHover = gl.getUniformLocation(prog, "u_hover");
  uScale = gl.getUniformLocation(prog, "u_scale");
  uJuiceS = gl.getUniformLocation(prog, "u_juice_s");
  uJuiceR = gl.getUniformLocation(prog, "u_juice_r");
  gl.uniform1i(gl.getUniformLocation(prog, "u_tex"), 0);

  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
}

function makeTexture(key: string, source: TexImageSource): WebGLTexture {
  const cached = texCache.get(key);
  if (cached) return cached;

  const tex = gl!.createTexture()!;
  gl!.bindTexture(gl!.TEXTURE_2D, tex);
  gl!.texImage2D(
    gl!.TEXTURE_2D,
    0,
    gl!.RGBA,
    gl!.RGBA,
    gl!.UNSIGNED_BYTE,
    source,
  );
  gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_WRAP_S, gl!.CLAMP_TO_EDGE);
  gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_WRAP_T, gl!.CLAMP_TO_EDGE);
  gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_MIN_FILTER, gl!.LINEAR);
  gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_MAG_FILTER, gl!.LINEAR);
  texCache.set(key, tex);
  return tex;
}

async function loadTexture(src: string): Promise<WebGLTexture> {
  const cached = texCache.get(src);
  if (cached) return cached;

  const res = await fetch(src);
  const blob = await res.blob();
  const bitmap = await createImageBitmap(blob);
  const tex = makeTexture(src, bitmap);
  bitmap.close();
  return tex;
}

function cleanup() {
  activeWrapper = null;
  cancelAnimationFrame(raf);
  if (canvas) canvas.style.display = "none";
  if (hiddenImg) {
    hiddenImg.style.visibility = "visible";
    hiddenImg = null;
  }
}

function render(now: number) {
  if (!gl || !canvas || !activeWrapper) return;

  // Delta time in seconds, capped at 1/20 (Balatro: math.min(1/20, real_dt))
  const dt = lastTime ? Math.min((now - lastTime) / 1000, 0.05) : 1 / 60;
  lastTime = now;

  // ── Hover: velocity-based easing (exp_times.scale) ───────────
  // game.lua: vel = exp*vel + (1-exp)*(target - current)
  const expS = Math.exp(-EXP_SCALE_K * dt);
  hoverVel = expS * hoverVel + (1 - expS) * (hoverGoal - hover);
  hover = Math.max(0, hover + hoverVel);

  // ── Juice: damped sinusoidal oscillation ─────────────────────
  // moveable.lua: move_juice()
  if (juiceActive) {
    juiceTime += dt;
    if (juiceTime >= JUICE_DUR) {
      juiceActive = false;
      juiceS = 0;
      juiceR = 0;
    } else {
      const remaining = (JUICE_DUR - juiceTime) / JUICE_DUR;
      juiceS =
        juiceScaleAmt *
        Math.sin(JUICE_SCALE_HZ * juiceTime) *
        remaining * remaining * remaining; // cubic decay
      // move_r uses juice.r * 2
      juiceR =
        juiceRAmt *
        2 *
        Math.sin(JUICE_R_HZ * juiceTime) *
        remaining * remaining; // quadratic decay
    }
  }

  // Ease juice through velocity smoothing (like move_scale / move_r)
  vtJuiceSVel = expS * vtJuiceSVel + (1 - expS) * (juiceS - vtJuiceS);
  vtJuiceS += vtJuiceSVel;

  const expR = Math.exp(-EXP_R_K * dt);
  vtJuiceRVel = expR * vtJuiceRVel + (1 - expR) * (juiceR - vtJuiceR);
  vtJuiceR += vtJuiceRVel;

  // ── Cleanup when fully released ──────────────────────────────
  if (
    hoverGoal === 0 &&
    hover <= 0 &&
    Math.abs(hoverVel) < 0.001 &&
    !juiceActive &&
    Math.abs(vtJuiceS) < 0.0001
  ) {
    cleanup();
    return;
  }

  // ── Draw ─────────────────────────────────────────────────────
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.uniform2f(uMouse, mouseX, mouseY);
  gl.uniform1f(uHover, hover);
  gl.uniform1f(uJuiceS, vtJuiceS);
  gl.uniform1f(uJuiceR, vtJuiceR);
  gl.drawArrays(gl.TRIANGLES, 0, 6);

  raf = requestAnimationFrame(render);
}

export async function startTilt(wrapper: HTMLElement, imgSrc: string) {
  if (!gl) init();
  if (!gl || !canvas) return;

  cancelAnimationFrame(raf);
  if (hiddenImg) {
    hiddenImg.style.visibility = "visible";
    hiddenImg = null;
  }
  const thisGen = ++gen;
  activeWrapper = wrapper;
  mouseX = 0;
  mouseY = 0;

  // Balatro snaps hover_tilt to 1 instantly on hover
  hover = 1;
  hoverGoal = 1;
  hoverVel = 0;

  // ── Trigger juice (Card:juice_up(0.05, 0.03)) ───────────────
  // card.lua override: scale = 0.05*0.4 = 0.02, rot = 0.4*±0.03 = ±0.012
  juiceActive = true;
  juiceTime = 0;
  juiceScaleAmt = 0.05 * 0.4; // 0.02
  juiceRAmt = 0.4 * 0.03 * (Math.random() > 0.5 ? 1 : -1); // ±0.012
  juiceS = 0;
  juiceR = 0;

  // Initial scale pop-down (moveable.lua: VT.scale = 1 - 0.6*amount)
  vtJuiceS = -0.6 * juiceScaleAmt; // -0.012
  vtJuiceSVel = 0;
  vtJuiceR = 0;
  vtJuiceRVel = 0;

  const rect = wrapper.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const w = rect.width + PAD * 2;
  const h = rect.height + PAD * 2;

  canvas.width = w * dpr;
  canvas.height = h * dpr;
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  canvas.style.left = `${-PAD}px`;
  canvas.style.top = `${-PAD}px`;
  canvas.style.display = "block";
  wrapper.appendChild(canvas);

  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.uniform2f(uScale, rect.width / w, rect.height / h);

  // Clear stale frame from previous card before async texture load
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);

  const imgEl = wrapper.querySelector("img") as HTMLImageElement | null;
  const tex = await loadTexture(imgSrc);
  if (thisGen !== gen) return;

  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, tex);

  hiddenImg = imgEl;
  if (hiddenImg) hiddenImg.style.visibility = "hidden";

  lastTime = performance.now();
  raf = requestAnimationFrame(render);
}

// Balatro tracks mouse directly — no easing on position
export function updateTilt(nx: number, ny: number) {
  mouseX = nx;
  mouseY = ny;
}

export function stopTilt() {
  gen++;
  // Balatro snaps hover_tilt to 0; we ease it out via velocity smoothing
  hoverGoal = 0;
}
