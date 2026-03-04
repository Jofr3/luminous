import {
  Application,
  Sprite,
  Texture,
  Filter,
  GlProgram,
  UniformGroup,
} from "pixi.js";

const FILTER_VERT = [
  "in vec2 aPosition;",
  "out vec2 vTextureCoord;",
  "",
  "uniform vec4 uInputSize;",
  "uniform vec4 uOutputFrame;",
  "uniform vec4 uOutputTexture;",
  "",
  "vec4 filterVertexPosition(void) {",
  "  vec2 position = aPosition * uOutputFrame.zw + uOutputFrame.xy;",
  "  position.x = position.x * (2.0 / uOutputTexture.x) - 1.0;",
  "  position.y = position.y * (2.0 * uOutputTexture.z / uOutputTexture.y) - uOutputTexture.z;",
  "  return vec4(position, 0.0, 1.0);",
  "}",
  "",
  "vec2 filterTextureCoord(void) {",
  "  return aPosition * (uOutputFrame.zw * uInputSize.zw);",
  "}",
  "",
  "void main(void) {",
  "  gl_Position = filterVertexPosition();",
  "  vTextureCoord = filterTextureCoord();",
  "}",
].join("\n");

const SPEC_FRAG = [
  "in vec2 vTextureCoord;",
  "out vec4 finalColor;",
  "",
  "uniform sampler2D uTexture;",
  "uniform float uTiltX;",
  "uniform float uTiltY;",
  "uniform float uIntensity;",
  "",
  "void main() {",
  "  vec2 lp = vec2(0.5 + uTiltX, 0.5 - uTiltY);",
  "  float d = distance(vTextureCoord, lp);",
  "  float spec = smoothstep(0.5, 0.0, d) * 0.15 * uIntensity;",
  "  finalColor = vec4(spec, spec, spec, spec);",
  "}",
].join("\n");

let app: Application | null = null;
let canvas: HTMLCanvasElement | null = null;
let sprite: Sprite | null = null;
let specUniforms: UniformGroup | null = null;
let specFilter: Filter | null = null;

let activeWrapper: HTMLElement | null = null;
let activeCardItem: HTMLElement | null = null;
let hoverRaf = 0;
let hoverPersp = 0;
let tiltX = 0;
let tiltY = 0;
let goalX = 0;
let goalY = 0;
let intensity = 0;
let releasing = false;

interface EaseState {
  tiltX: number;
  tiltY: number;
  persp: number;
  raf: number;
}
const easeStates = new WeakMap<HTMLElement, EaseState>();

async function init() {
  app = new Application();
  await app.init({
    backgroundAlpha: 0,
    antialias: true,
    preference: "webgl",
    resolution: window.devicePixelRatio || 1,
  });

  canvas = app.canvas as HTMLCanvasElement;
  canvas.style.cssText =
    "position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none;";

  app.ticker.stop();

  specUniforms = new UniformGroup({
    uTiltX: { value: 0, type: "f32" },
    uTiltY: { value: 0, type: "f32" },
    uIntensity: { value: 0, type: "f32" },
  });

  specFilter = new Filter({
    glProgram: GlProgram.from({
      vertex: FILTER_VERT,
      fragment: SPEC_FRAG,
      name: "specular-filter",
    }),
    resources: { specUniforms },
  });
}

function applyTransform(el: HTMLElement, tx: number, ty: number, persp: number) {
  const degY = (tx * 180) / Math.PI;
  const degX = (-ty * 180) / Math.PI;
  el.style.transform = `perspective(${persp}px) rotateY(${degY}deg) rotateX(${degX}deg)`;
}

function cancelEaseBack(cardItem: HTMLElement) {
  const state = easeStates.get(cardItem);
  if (!state) return;
  cancelAnimationFrame(state.raf);
  easeStates.delete(cardItem);
  cardItem.style.transform = "";
  cardItem.style.zIndex = "";
}

function startEaseBack(cardItem: HTMLElement, tx: number, ty: number, persp: number) {
  cancelEaseBack(cardItem);

  const state: EaseState = { tiltX: tx, tiltY: ty, persp, raf: 0 };
  easeStates.set(cardItem, state);
  cardItem.style.zIndex = "10";

  function animate() {
    state.tiltX += (0 - state.tiltX) * 0.08;
    state.tiltY += (0 - state.tiltY) * 0.08;

    if (Math.abs(state.tiltX) < 0.001 && Math.abs(state.tiltY) < 0.001) {
      cardItem.style.transform = "";
      cardItem.style.zIndex = "";
      easeStates.delete(cardItem);
      return;
    }

    applyTransform(cardItem, state.tiltX, state.tiltY, state.persp);
    state.raf = requestAnimationFrame(animate);
  }

  animate();
}

function render() {
  if (!app || !canvas || !activeWrapper || !activeCardItem) return;

  tiltX += (goalX - tiltX) * 0.12;
  tiltY += (goalY - tiltY) * 0.12;

  if (releasing) {
    intensity += (0 - intensity) * 0.1;
    if (intensity < 0.01) {
      cancelAnimationFrame(hoverRaf);
      if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
      startEaseBack(activeCardItem, tiltX, tiltY, hoverPersp);
      activeWrapper = null;
      activeCardItem = null;
      releasing = false;
      return;
    }
  } else {
    intensity += (1 - intensity) * 0.12;
  }

  applyTransform(activeCardItem, tiltX, tiltY, hoverPersp);

  specUniforms!.uniforms.uTiltX = tiltX;
  specUniforms!.uniforms.uTiltY = tiltY;
  specUniforms!.uniforms.uIntensity = intensity;

  app.render();

  hoverRaf = requestAnimationFrame(render);
}

export async function startTilt(wrapper: HTMLElement, _imgSrc: string) {
  if (!app) await init();
  if (!app || !canvas) return;

  const cardItem = wrapper.closest(".card-item") as HTMLElement;
  if (!cardItem) return;

  cancelAnimationFrame(hoverRaf);

  if (activeCardItem && activeCardItem !== cardItem) {
    if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
    startEaseBack(activeCardItem, tiltX, tiltY, hoverPersp);
  }

  cancelEaseBack(cardItem);

  activeWrapper = wrapper;
  activeCardItem = cardItem;
  tiltX = 0;
  tiltY = 0;
  goalX = 0;
  goalY = 0;
  intensity = 0;
  releasing = false;

  cardItem.style.zIndex = "10";
  cardItem.style.transform = "";

  wrapper.style.position = "relative";
  const rect = wrapper.getBoundingClientRect();
  hoverPersp = 3 * rect.width;

  app.renderer.resize(rect.width, rect.height);
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  wrapper.appendChild(canvas);

  if (!sprite) {
    sprite = new Sprite(Texture.WHITE);
    sprite.filters = [specFilter!];
    app.stage.addChild(sprite);
  }

  sprite.position.set(0, 0);
  sprite.width = rect.width;
  sprite.height = rect.height;

  render();
}

export function updateTilt(wrapper: HTMLElement, nx: number, ny: number) {
  if (wrapper !== activeWrapper) return;
  goalX = -nx * 0.25;
  goalY = ny * 0.25;
}

export function stopTilt(wrapper: HTMLElement) {
  if (wrapper !== activeWrapper) return;
  releasing = true;
  goalX = 0;
  goalY = 0;
}
