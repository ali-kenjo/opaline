// Phase 0 spike A: proves that a WebGL2 canvas renders inside the transparent Tauri layer
// window and composites with real transparency. It draws one SDF rounded-rect "glass" surface
// (tint, rim light, soft shadow) behind a DOM element. The real compositor (Phase 2) replaces
// it; the measurements it reports go into docs/PROGRESS.md.

const VERTEX = `#version 300 es
in vec2 a_pos;
void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }
`;

const FRAGMENT = `#version 300 es
precision highp float;
uniform vec2 u_resolution;   // canvas size in device px
uniform vec4 u_rect;         // x, y, w, h in device px, origin top-left
uniform float u_radius;      // device px
uniform vec3 u_tint;
out vec4 o_color;

float sdRoundRect(vec2 p, vec2 halfSize, float r) {
  vec2 q = abs(p) - halfSize + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}

void main() {
  vec2 frag = vec2(gl_FragCoord.x, u_resolution.y - gl_FragCoord.y);
  vec2 center = u_rect.xy + u_rect.zw * 0.5;
  float d = sdRoundRect(frag - center, u_rect.zw * 0.5, u_radius);

  // Soft drop shadow, offset down.
  float ds = sdRoundRect(frag - center - vec2(0.0, 6.0), u_rect.zw * 0.5, u_radius);
  float shadow = (1.0 - smoothstep(-8.0, 22.0, ds)) * 0.28;

  float inside = 1.0 - smoothstep(-0.75, 0.75, d);
  // Rim: a thin highlight, strongest at the top-left.
  vec2 rel = (frag - u_rect.xy) / u_rect.zw;
  float rimMask = 1.0 - smoothstep(0.0, 1.5, abs(d + 0.75));
  float rim = rimMask * mix(0.65, 0.12, clamp((rel.x + rel.y) * 0.5, 0.0, 1.0));

  vec3 body = u_tint;
  float bodyAlpha = 0.55;
  vec4 glass = vec4(body * bodyAlpha + vec3(rim), bodyAlpha + rim) * inside;
  vec4 shade = vec4(0.0, 0.0, 0.0, shadow) * (1.0 - inside);
  o_color = glass + shade; // premultiplied alpha
}
`;

export interface SpikeResult {
  webgl2: boolean;
  renderer: string | null;
  vendor: string | null;
  maxTextureSize: number | null;
  premultipliedAlpha: boolean | null;
  firstFrameMs: number | null;
  error: string | null;
}

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error("createShader failed");
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!(gl.getShaderParameter(shader, gl.COMPILE_STATUS) as boolean)) {
    throw new Error(gl.getShaderInfoLog(shader) ?? "shader compile failed");
  }
  return shader;
}

export interface GlassSpike {
  result: SpikeResult;
  /** Redraws the surface under `target`. Cheap; only called when layout changes. */
  draw: (target: DOMRect) => void;
}

export function startGlassSpike(
  canvas: HTMLCanvasElement,
  tint: [number, number, number],
): GlassSpike {
  const result: SpikeResult = {
    webgl2: false,
    renderer: null,
    vendor: null,
    maxTextureSize: null,
    premultipliedAlpha: null,
    firstFrameMs: null,
    error: null,
  };
  const gl = canvas.getContext("webgl2", { premultipliedAlpha: true, antialias: false });
  if (!gl) {
    result.error = "webgl2 context unavailable";
    return { result, draw: () => undefined };
  }
  result.webgl2 = true;
  const debug = gl.getExtension("WEBGL_debug_renderer_info");
  result.renderer = debug
    ? (gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) as string)
    : (gl.getParameter(gl.RENDERER) as string);
  result.vendor = debug
    ? (gl.getParameter(debug.UNMASKED_VENDOR_WEBGL) as string)
    : (gl.getParameter(gl.VENDOR) as string);
  result.maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
  result.premultipliedAlpha = gl.getContextAttributes()?.premultipliedAlpha ?? null;

  let program: WebGLProgram;
  try {
    const p = gl.createProgram();
    gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, VERTEX));
    gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, FRAGMENT));
    gl.linkProgram(p);
    if (!(gl.getProgramParameter(p, gl.LINK_STATUS) as boolean)) {
      throw new Error(gl.getProgramInfoLog(p) ?? "link failed");
    }
    program = p;
  } catch (e) {
    result.error = e instanceof Error ? e.message : String(e);
    return { result, draw: () => undefined };
  }

  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const aPos = gl.getAttribLocation(program, "a_pos");
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
  const uRes = gl.getUniformLocation(program, "u_resolution");
  const uRect = gl.getUniformLocation(program, "u_rect");
  const uRadius = gl.getUniformLocation(program, "u_radius");
  const uTint = gl.getUniformLocation(program, "u_tint");

  const draw = (target: DOMRect) => {
    const t0 = performance.now();
    const dpr = window.devicePixelRatio || 1;
    const w = Math.round(window.innerWidth * dpr);
    const h = Math.round(window.innerHeight * dpr);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    gl.viewport(0, 0, w, h);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(program);
    gl.uniform2f(uRes, w, h);
    gl.uniform4f(uRect, target.x * dpr, target.y * dpr, target.width * dpr, target.height * dpr);
    gl.uniform1f(uRadius, 28 * dpr);
    gl.uniform3f(uTint, tint[0], tint[1], tint[2]);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    if (result.firstFrameMs === null) {
      gl.finish();
      result.firstFrameMs = Math.round((performance.now() - t0) * 100) / 100;
    }
  };
  return { result, draw };
}
