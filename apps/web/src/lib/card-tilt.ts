const VERT = [
  "precision mediump float;",
  "attribute vec2 a_pos;",
  "varying vec2 v_uv;",
  "uniform vec2 u_tilt;",
  "uniform vec2 u_scale;",
  "void main() {",
  "  v_uv = a_pos * 0.5 + 0.5;",
  "  v_uv.y = 1.0 - v_uv.y;",
  "  vec3 p = vec3(a_pos, 0.0);",
  "  float cy = cos(u_tilt.x);",
  "  float sy = sin(u_tilt.x);",
  "  p = vec3(cy * p.x + sy * p.z, p.y, -sy * p.x + cy * p.z);",
  "  float cx = cos(u_tilt.y);",
  "  float sx = sin(u_tilt.y);",
  "  p = vec3(p.x, cx * p.y - sx * p.z, sx * p.y + cx * p.z);",
  "  float d = 3.0;",
  "  float w = d - p.z;",
  "  gl_Position = vec4(p.xy * u_scale * d, 0.0, w);",
  "}",
].join("\n");

const FRAG = [
  "precision mediump float;",
  "varying vec2 v_uv;",
  "uniform sampler2D u_tex;",
  "uniform vec2 u_tilt;",
  "void main() {",
  "  vec4 c = texture2D(u_tex, v_uv);",
  "  vec2 lp = vec2(0.5 + u_tilt.x, 0.5 - u_tilt.y);",
  "  float d = distance(v_uv, lp);",
  "  float spec = smoothstep(0.5, 0.0, d) * 0.15;",
  "  gl_FragColor = vec4(c.rgb + spec, c.a);",
  "}",
].join("\n");

const PAD = 24;

let canvas: HTMLCanvasElement | null = null;
let gl: WebGLRenderingContext | null = null;
let uTilt: WebGLUniformLocation | null = null;
let uScale: WebGLUniformLocation | null = null;
let texCache = new Map<string, WebGLTexture>();
let raf = 0;
let gen = 0;
let active = false;
let releasing = false;
let tiltX = 0;
let tiltY = 0;
let goalX = 0;
let goalY = 0;
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
    "position:fixed;pointer-events:none;z-index:9999;display:none;";
  document.body.appendChild(canvas);

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

  uTilt = gl.getUniformLocation(prog, "u_tilt");
  uScale = gl.getUniformLocation(prog, "u_scale");
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
  active = false;
  releasing = false;
  activeWrapper = null;
  cancelAnimationFrame(raf);
  if (canvas) canvas.style.display = "none";
  if (hiddenImg) {
    hiddenImg.style.visibility = "visible";
    hiddenImg = null;
  }
}

function render() {
  if (!gl || !canvas || !activeWrapper) return;

  const rect = activeWrapper.getBoundingClientRect();
  canvas.style.left = `${rect.left - PAD}px`;
  canvas.style.top = `${rect.top - PAD}px`;

  const ease = releasing ? 0.08 : 0.12;
  tiltX += (goalX - tiltX) * ease;
  tiltY += (goalY - tiltY) * ease;

  if (releasing && Math.abs(tiltX) < 0.001 && Math.abs(tiltY) < 0.001) {
    cleanup();
    return;
  }

  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.uniform2f(uTilt, tiltX, tiltY);
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
  active = true;
  releasing = false;
  activeWrapper = wrapper;
  tiltX = 0;
  tiltY = 0;
  goalX = 0;
  goalY = 0;

  const rect = wrapper.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const w = rect.width + PAD * 2;
  const h = rect.height + PAD * 2;

  canvas.width = w * dpr;
  canvas.height = h * dpr;
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  canvas.style.left = `${rect.left - PAD}px`;
  canvas.style.top = `${rect.top - PAD}px`;
  canvas.style.display = "block";

  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.uniform2f(uScale, rect.width / w, rect.height / h);

  const imgEl = wrapper.querySelector("img") as HTMLImageElement | null;
  const tex = await loadTexture(imgSrc);
  if (thisGen !== gen) return;

  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, tex);

  hiddenImg = imgEl;
  if (hiddenImg) hiddenImg.style.visibility = "hidden";

  render();
}

export function updateTilt(nx: number, ny: number) {
  goalX = -nx * 0.25;
  goalY = ny * 0.25;
}

export function stopTilt() {
  gen++;
  releasing = true;
  goalX = 0;
  goalY = 0;
}
