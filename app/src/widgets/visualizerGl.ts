// Lightweight WebGL2 renderer for heavy Visualizer styles (4.11: spectrogram waterfall &
// bass-reactive particles). Returns null cleanly when WebGL2 is unavailable so the 2D canvas
// fallback handles software environments transparently.

export type GlColorMode = "theme" | "gradient" | "spectrum" | "fire" | "ocean";

export interface VisualizerGl {
  drawSpectrogram(
    bands: readonly number[],
    width: number,
    height: number,
    dpr: number,
    colorMode: GlColorMode,
    accent: readonly [number, number, number],
    still: boolean,
  ): void;
  drawParticles(
    bands: readonly number[],
    width: number,
    height: number,
    dpr: number,
    colorMode: GlColorMode,
    accent: readonly [number, number, number],
    still: boolean,
  ): void;
  dispose(): void;
}

const SPEC_COLS = 128;
const SPEC_ROWS = 32;
const PARTICLE_COUNT = 84;

const MODE_ID: Record<GlColorMode, number> = {
  theme: 0,
  gradient: 1,
  spectrum: 2,
  fire: 3,
  ocean: 4,
};

const QUAD_VS = `#version 300 es
in vec2 a_pos;
out vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

const SPEC_FS = `#version 300 es
precision mediump float;
in vec2 v_uv;
uniform sampler2D u_tex;
uniform float u_offset;
uniform int u_mode;
uniform vec3 u_accent;
out vec4 outColor;

vec3 palette(float v, float f) {
  if (u_mode == 3) {
    return mix(vec3(0.45, 0.05, 0.02), mix(vec3(0.95, 0.42, 0.08), vec3(1.0, 0.93, 0.55), v), clamp(v * 1.2, 0.0, 1.0));
  }
  if (u_mode == 4) {
    return mix(vec3(0.04, 0.25, 0.52), vec3(0.32, 0.92, 0.96), clamp(v * 0.8 + f * 0.25, 0.0, 1.0));
  }
  if (u_mode == 2) {
    float h = (1.0 - f) * 4.4;
    vec3 k = clamp(abs(mod(h + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
    return mix(vec3(0.18), k, 0.85) * (0.55 + 0.45 * v);
  }
  if (u_mode == 1) {
    return mix(vec3(0.28, 0.55, 0.96), vec3(0.86, 0.42, 0.88), f) * (0.5 + 0.55 * v);
  }
  return mix(u_accent * 0.4, min(vec3(1.0), u_accent * 1.35 + vec3(0.18)), v);
}

void main() {
  float x = fract(v_uv.x + u_offset);
  float v = texture(u_tex, vec2(x, v_uv.y)).r;
  float alpha = smoothstep(0.03, 0.16, v) * (0.28 + 0.72 * v);
  vec3 col = palette(v, v_uv.y);
  outColor = vec4(col * alpha, alpha);
}`;

const PARTICLE_VS = `#version 300 es
in vec2 a_pos;
in float a_size;
in float a_energy;
in float a_band;
out float v_energy;
out float v_band;
void main() {
  v_energy = a_energy;
  v_band = a_band;
  gl_Position = vec4(a_pos, 0.0, 1.0);
  gl_PointSize = a_size;
}`;

const PARTICLE_FS = `#version 300 es
precision mediump float;
in float v_energy;
in float v_band;
uniform int u_mode;
uniform vec3 u_accent;
out vec4 outColor;

vec3 colorFor(float b, float e) {
  if (u_mode == 3) return mix(vec3(0.95, 0.3, 0.08), vec3(1.0, 0.9, 0.48), e);
  if (u_mode == 4) return mix(vec3(0.15, 0.62, 0.92), vec3(0.55, 0.98, 0.92), b);
  if (u_mode == 2) {
    float h = (1.0 - b) * 4.6;
    return clamp(abs(mod(h + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
  }
  if (u_mode == 1) return mix(vec3(0.32, 0.58, 0.98), vec3(0.9, 0.46, 0.88), b);
  return mix(u_accent * 0.75, min(vec3(1.0), u_accent + vec3(0.25)), e);
}

void main() {
  vec2 d = gl_PointCoord - 0.5;
  float dist = length(d);
  if (dist > 0.5) discard;
  float glow = smoothstep(0.5, 0.06, dist);
  float alpha = glow * (0.32 + 0.68 * v_energy);
  vec3 col = colorFor(v_band, v_energy);
  outColor = vec4(col * alpha, alpha);
}`;

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader | null {
  const s = gl.createShader(type);
  if (!s) return null;
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    gl.deleteShader(s);
    return null;
  }
  return s;
}

function link(gl: WebGL2RenderingContext, vsSrc: string, fsSrc: string): WebGLProgram | null {
  const vs = compile(gl, gl.VERTEX_SHADER, vsSrc);
  const fs = compile(gl, gl.FRAGMENT_SHADER, fsSrc);
  if (!vs || !fs) {
    if (vs) gl.deleteShader(vs);
    if (fs) gl.deleteShader(fs);
    return null;
  }
  const p = gl.createProgram();
  gl.attachShader(p, vs);
  gl.attachShader(p, fs);
  gl.linkProgram(p);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    gl.deleteProgram(p);
    return null;
  }
  return p;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  band: number;
  phase: number;
}

function seedParticles(): Particle[] {
  const out: Particle[] = [];
  for (let i = 0; i < PARTICLE_COUNT; i++) {
    const a = (i / PARTICLE_COUNT) * Math.PI * 2 + (i % 7) * 0.31;
    const r = 0.16 + ((i * 37) % 100) / 145;
    out.push({
      x: Math.cos(a) * r,
      y: Math.sin(a) * r,
      vx: Math.cos(a + 0.5) * 0.008,
      vy: Math.sin(a + 0.5) * 0.008,
      band: (i % 32) / 31,
      phase: i * 0.73,
    });
  }
  return out;
}

export function createVisualizerGl(canvas: HTMLCanvasElement): VisualizerGl | null {
  const gl = canvas.getContext("webgl2", {
    alpha: true,
    antialias: true,
    premultipliedAlpha: true,
    powerPreference: "low-power",
  });
  if (!gl) return null;

  const specProg = link(gl, QUAD_VS, SPEC_FS);
  const partProg = link(gl, PARTICLE_VS, PARTICLE_FS);
  if (!specProg || !partProg) {
    if (specProg) gl.deleteProgram(specProg);
    if (partProg) gl.deleteProgram(partProg);
    return null;
  }
  const quadBuf = gl.createBuffer();
  const partBuf = gl.createBuffer();
  const specTex = gl.createTexture();

  gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
    gl.STATIC_DRAW,
  );

  gl.bindTexture(gl.TEXTURE_2D, specTex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.R8,
    SPEC_COLS,
    SPEC_ROWS,
    0,
    gl.RED,
    gl.UNSIGNED_BYTE,
    new Uint8Array(SPEC_COLS * SPEC_ROWS),
  );

  const column = new Uint8Array(SPEC_ROWS);
  let writeCol = 0;
  let seededSpec = false;
  const particles = seedParticles();
  const partData = new Float32Array(PARTICLE_COUNT * 5);

  const syncViewport = (w: number, h: number, dpr: number) => {
    const pw = Math.max(1, Math.round(w * dpr));
    const ph = Math.max(1, Math.round(h * dpr));
    if (canvas.width !== pw || canvas.height !== ph) {
      canvas.width = pw;
      canvas.height = ph;
    }
    gl.viewport(0, 0, pw, ph);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  };

  return {
    drawSpectrogram(bands, width, height, dpr, colorMode, accent, still) {
      syncViewport(width, height, dpr);
      gl.bindTexture(gl.TEXTURE_2D, specTex);
      if (still && !seededSpec) {
        // Fill full waterfall history deterministically for still snapshots.
        const full = new Uint8Array(SPEC_COLS * SPEC_ROWS);
        for (let c = 0; c < SPEC_COLS; c++) {
          const wave = 0.65 + 0.35 * Math.sin(c * 0.14);
          for (let r = 0; r < SPEC_ROWS; r++) {
            const idx = Math.floor((r / SPEC_ROWS) * bands.length);
            const v = Math.min(1, (bands[idx] ?? 0) * wave);
            full[r * SPEC_COLS + c] = Math.round(v * 255);
          }
        }
        gl.texSubImage2D(
          gl.TEXTURE_2D,
          0,
          0,
          0,
          SPEC_COLS,
          SPEC_ROWS,
          gl.RED,
          gl.UNSIGNED_BYTE,
          full,
        );
        seededSpec = true;
      } else {
        for (let r = 0; r < SPEC_ROWS; r++) {
          const idx = Math.floor((r / SPEC_ROWS) * bands.length);
          column[r] = Math.round(Math.min(1, Math.max(0, bands[idx] ?? 0)) * 255);
        }
        gl.texSubImage2D(
          gl.TEXTURE_2D,
          0,
          writeCol,
          0,
          1,
          SPEC_ROWS,
          gl.RED,
          gl.UNSIGNED_BYTE,
          column,
        );
        writeCol = (writeCol + 1) % SPEC_COLS;
      }

      gl.useProgram(specProg);
      gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
      const posLoc = gl.getAttribLocation(specProg, "a_pos");
      gl.enableVertexAttribArray(posLoc);
      gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);
      gl.uniform1i(gl.getUniformLocation(specProg, "u_tex"), 0);
      gl.uniform1f(gl.getUniformLocation(specProg, "u_offset"), writeCol / SPEC_COLS);
      gl.uniform1i(gl.getUniformLocation(specProg, "u_mode"), MODE_ID[colorMode]);
      gl.uniform3f(gl.getUniformLocation(specProg, "u_accent"), accent[0], accent[1], accent[2]);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    },

    drawParticles(bands, width, height, dpr, colorMode, accent, still) {
      syncViewport(width, height, dpr);
      let bass = 0;
      const bassBins = Math.max(1, Math.min(5, bands.length));
      for (let i = 0; i < bassBins; i++) bass += bands[i] ?? 0;
      bass /= bassBins;

      for (let i = 0; i < PARTICLE_COUNT; i++) {
        const p = particles[i];
        if (!p) continue;
        const bIdx = Math.min(bands.length - 1, Math.floor(p.band * bands.length));
        const energy = bands[bIdx] ?? 0;
        if (!still) {
          const boost = 1 + bass * 2.6 + energy * 1.4;
          p.x += p.vx * boost;
          p.y += p.vy * boost;
          if (p.x > 1.05 || p.x < -1.05 || p.y > 1.05 || p.y < -1.05) {
            const a = p.phase + bass * 3.1;
            p.x = Math.cos(a) * 0.08;
            p.y = Math.sin(a) * 0.08;
          }
        }
        const off = i * 5;
        partData[off] = p.x;
        partData[off + 1] = p.y;
        partData[off + 2] = (5 + energy * 15 + bass * 7) * dpr;
        partData[off + 3] = Math.min(1, 0.25 + energy * 0.85);
        partData[off + 4] = p.band;
      }

      gl.useProgram(partProg);
      gl.bindBuffer(gl.ARRAY_BUFFER, partBuf);
      gl.bufferData(gl.ARRAY_BUFFER, partData, gl.DYNAMIC_DRAW);
      const stride = 5 * 4;
      const posLoc = gl.getAttribLocation(partProg, "a_pos");
      const sizeLoc = gl.getAttribLocation(partProg, "a_size");
      const energyLoc = gl.getAttribLocation(partProg, "a_energy");
      const bandLoc = gl.getAttribLocation(partProg, "a_band");
      gl.enableVertexAttribArray(posLoc);
      gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, stride, 0);
      gl.enableVertexAttribArray(sizeLoc);
      gl.vertexAttribPointer(sizeLoc, 1, gl.FLOAT, false, stride, 8);
      gl.enableVertexAttribArray(energyLoc);
      gl.vertexAttribPointer(energyLoc, 1, gl.FLOAT, false, stride, 12);
      gl.enableVertexAttribArray(bandLoc);
      gl.vertexAttribPointer(bandLoc, 1, gl.FLOAT, false, stride, 16);
      gl.uniform1i(gl.getUniformLocation(partProg, "u_mode"), MODE_ID[colorMode]);
      gl.uniform3f(gl.getUniformLocation(partProg, "u_accent"), accent[0], accent[1], accent[2]);
      gl.drawArrays(gl.POINTS, 0, PARTICLE_COUNT);
    },

    dispose() {
      gl.deleteTexture(specTex);
      gl.deleteBuffer(quadBuf);
      gl.deleteBuffer(partBuf);
      gl.deleteProgram(specProg);
      gl.deleteProgram(partProg);
    },
  };
}
