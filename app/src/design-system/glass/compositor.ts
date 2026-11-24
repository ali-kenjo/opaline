// The glass compositor (docs/DESIGN.md §4): one WebGL2 canvas behind the DOM of a layer window,
// drawing every glass surface in one instanced pass, plus the Edit/Peek backdrop. It draws only
// when told something changed (`invalidate`), on the shared scheduler's frame, so glass and DOM
// move on the same tick.
import type { Cubic } from "../shapes/cubic";
import { scheduler } from "../motion/scheduler";
import { BACKDROP_FRAGMENT, BACKDROP_VERTEX, FRAGMENT, VERTEX } from "./shaders";

/** One glass surface, in CSS px of the layer window. */
export interface Surface {
  x: number;
  y: number;
  w: number;
  h: number;
  radius: number;
  /** Tint color (the surface-container role), 0–1 channels. */
  tint: readonly [number, number, number];
  /** Tint strength 0–1 (glass slider, raised for legibility). */
  tintAlpha: number;
  dimmed?: number;
  hovered?: boolean;
  /** Pointer position (window CSS px) while hovered. */
  pointer?: readonly [number, number];
  lifted?: number;
  /** An expressive shape instead of a rounded rect: cubics in surface-local CSS px. */
  shape?: readonly Cubic[];
  /** Per-widget style (ADR 0011); unset fields keep the designed look. */
  look?: SurfaceLook;
}

/** Glass effects of one surface. Strengths are 0–2 where 1 is the designed look. */
export interface SurfaceLook {
  /** Extra blur, 0 (the designed blur) … 1 (much softer). */
  blur?: number;
  refraction?: number;
  rim?: number;
  grain?: number;
  shadow?: number;
  /** No wallpaper through this surface. */
  opaque?: boolean;
  /** Inside border, CSS px. */
  borderWidth?: number;
  /** Border color, 0–1 channels with alpha. */
  borderColor?: readonly [number, number, number, number];
}

/** Mip levels the blur slider spans on the quarter-res wallpaper. */
const MAX_BLUR_LOD = 4;

export interface WallpaperPlacement {
  /** The layer window's origin inside its monitor (CSS px). */
  offsetX: number;
  offsetY: number;
  monitorWidth: number;
  monitorHeight: number;
}

const SHADOW_MARGIN = 48;
const INSTANCE_FLOATS = 28;
const POLY_TEX_WIDTH = 512;
const CURVE_STEPS = 8;

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const s = gl.createShader(type);
  if (!s) throw new Error("createShader failed");
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!(gl.getShaderParameter(s, gl.COMPILE_STATUS) as boolean))
    throw new Error(gl.getShaderInfoLog(s) ?? "shader compile failed");
  return s;
}

function program(gl: WebGL2RenderingContext, vs: string, fs: string): WebGLProgram {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!(gl.getProgramParameter(p, gl.LINK_STATUS) as boolean))
    throw new Error(gl.getProgramInfoLog(p) ?? "link failed");
  return p;
}

/** Flattens a closed cubic outline into a polygon (vertices in the same space). */
export function flatten(cubics: readonly Cubic[], steps = CURVE_STEPS): number[] {
  const out: number[] = [];
  for (const c of cubics) {
    for (let i = 0; i < steps; i++) {
      const p = c.pointOnCurve(i / steps);
      out.push(p.x, p.y);
    }
  }
  return out;
}

export function sameSurfaces(a: readonly Surface[], b: readonly Surface[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((s, i) => {
    const t = b[i];
    return (
      t !== undefined &&
      s.shape === t.shape &&
      JSON.stringify({ ...s, shape: undefined }) === JSON.stringify({ ...t, shape: undefined })
    );
  });
}

export class GlassCompositor {
  private readonly gl: WebGL2RenderingContext;
  private readonly glass: WebGLProgram;
  private readonly backdrop: WebGLProgram;
  private readonly quad: WebGLBuffer;
  private readonly instances: WebGLBuffer;
  private readonly vao: WebGLVertexArrayObject;
  private readonly backdropVao: WebGLVertexArrayObject;
  private readonly polyTex: WebGLTexture;
  private wallpaperTex: WebGLTexture | null = null;
  private backdropTex: WebGLTexture | null = null;
  private surfaces: Surface[] = [];
  private placement: WallpaperPlacement = {
    offsetX: 0,
    offsetY: 0,
    monitorWidth: 1,
    monitorHeight: 1,
  };
  private backdropOpacity = 0;
  private opaque = false;
  private readonly unsubscribe: () => void;
  private dirty = false;
  /** Frames drawn (the Lab shows it to prove idle means no frames). */
  draws = 0;

  /** Returns `null` where WebGL2 isn't available; callers then use the CSS fallback. */
  static create(canvas: HTMLCanvasElement): GlassCompositor | null {
    const gl = canvas.getContext("webgl2", {
      premultipliedAlpha: true,
      antialias: false,
      alpha: true,
    });
    if (!gl) return null;
    try {
      return new GlassCompositor(canvas, gl);
    } catch (e) {
      console.error("glass compositor unavailable", e);
      return null;
    }
  }

  private constructor(
    private readonly canvas: HTMLCanvasElement,
    gl: WebGL2RenderingContext,
  ) {
    this.gl = gl;
    this.glass = program(gl, VERTEX, FRAGMENT);
    this.backdrop = program(gl, BACKDROP_VERTEX, BACKDROP_FRAGMENT);
    this.quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
    this.instances = gl.createBuffer();

    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instances);
    for (let i = 0; i < INSTANCE_FLOATS / 4; i++) {
      const loc = 1 + i;
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 4, gl.FLOAT, false, INSTANCE_FLOATS * 4, i * 16);
      gl.vertexAttribDivisor(loc, 1);
    }
    this.backdropVao = gl.createVertexArray();
    gl.bindVertexArray(this.backdropVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);

    this.polyTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.polyTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, 1, 1, 0, gl.RGBA, gl.FLOAT, new Float32Array(4));

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    this.unsubscribe = scheduler.onFrame((now) => {
      if (this.dirty) this.draw(now);
    });
  }

  dispose(): void {
    this.unsubscribe();
  }

  /** Replaces the surfaces and schedules a frame, unless nothing about them changed. */
  setSurfaces(surfaces: Surface[]): void {
    if (sameSurfaces(this.surfaces, surfaces)) return;
    this.surfaces = surfaces;
    this.invalidate();
  }

  setPlacement(p: WallpaperPlacement): void {
    const cur = this.placement;
    if (
      cur.offsetX === p.offsetX &&
      cur.offsetY === p.offsetY &&
      cur.monitorWidth === p.monitorWidth &&
      cur.monitorHeight === p.monitorHeight
    ) {
      return;
    }
    this.placement = p;
    this.invalidate();
  }

  setOpaque(opaque: boolean): void {
    if (this.opaque === opaque) return;
    this.opaque = opaque;
    this.invalidate();
  }

  /** Edit/Peek backdrop opacity (0 hides it; 0.92 when fully shown). */
  setBackdropOpacity(opacity: number): void {
    if (this.backdropOpacity === opacity) return;
    this.backdropOpacity = opacity;
    this.invalidate();
  }

  setWallpaper(source: TexImageSource | null, which: "glass" | "backdrop" = "glass"): void {
    const gl = this.gl;
    let tex = which === "glass" ? this.wallpaperTex : this.backdropTex;
    if (!source) {
      if (tex) gl.deleteTexture(tex);
      if (which === "glass") this.wallpaperTex = null;
      else this.backdropTex = null;
      this.invalidate();
      return;
    }
    tex ??= gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    // Mip levels give each surface its own extra blur (style) without another pass.
    gl.generateMipmap(gl.TEXTURE_2D);
    if (which === "glass") this.wallpaperTex = tex;
    else this.backdropTex = tex;
    this.invalidate();
  }

  invalidate(): void {
    this.dirty = true;
    scheduler.invalidate();
  }

  /**
   * Draws a frame now and reads back the premultiplied RGBA at (x, y) in CSS pixels of the
   * canvas. For diagnostics (the Lab's in-webview check); it costs a GPU sync.
   */
  probe(x: number, y: number): [number, number, number, number] {
    this.draw(performance.now());
    const dpr = window.devicePixelRatio || 1;
    const px = new Uint8Array(4);
    const gl = this.gl;
    gl.readPixels(
      Math.round(x * dpr),
      this.canvas.height - 1 - Math.round(y * dpr),
      1,
      1,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      px,
    );
    return [px[0] ?? 0, px[1] ?? 0, px[2] ?? 0, px[3] ?? 0];
  }

  private resize(): [number, number] {
    const dpr = window.devicePixelRatio || 1;
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    const pw = Math.max(1, Math.round(w * dpr));
    const ph = Math.max(1, Math.round(h * dpr));
    if (this.canvas.width !== pw || this.canvas.height !== ph) {
      this.canvas.width = pw;
      this.canvas.height = ph;
    }
    return [w, h];
  }

  private uploadPolygons(): number[][] {
    const polys = this.surfaces.map((s) => (s.shape ? flatten(s.shape) : []));
    const total = polys.reduce((n, p) => n + p.length / 2, 0);
    if (total === 0) return polys;
    const rows = Math.ceil(total / POLY_TEX_WIDTH);
    const data = new Float32Array(POLY_TEX_WIDTH * rows * 4);
    let i = 0;
    for (const p of polys) {
      for (let k = 0; k < p.length; k += 2) {
        data[i * 4] = p[k] ?? 0;
        data[i * 4 + 1] = p[k + 1] ?? 0;
        i++;
      }
    }
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.polyTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, POLY_TEX_WIDTH, rows, 0, gl.RGBA, gl.FLOAT, data);
    return polys;
  }

  private draw(now: number): void {
    this.dirty = false;
    this.draws++;
    const gl = this.gl;
    const [w, h] = this.resize();
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    const p = this.placement;

    if (this.backdropOpacity > 0.001 && this.backdropTex) {
      gl.useProgram(this.backdrop);
      gl.bindVertexArray(this.backdropVao);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.backdropTex);
      gl.uniform1i(gl.getUniformLocation(this.backdrop, "u_backdrop"), 0);
      gl.uniform2f(gl.getUniformLocation(this.backdrop, "u_viewport"), w, h);
      gl.uniform2f(gl.getUniformLocation(this.backdrop, "u_windowOffset"), p.offsetX, p.offsetY);
      gl.uniform2f(
        gl.getUniformLocation(this.backdrop, "u_monitorSize"),
        p.monitorWidth,
        p.monitorHeight,
      );
      gl.uniform1f(gl.getUniformLocation(this.backdrop, "u_opacity"), this.backdropOpacity);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }

    if (this.surfaces.length === 0) return;
    const polys = this.uploadPolygons();
    const data = new Float32Array(this.surfaces.length * INSTANCE_FLOATS);
    let polyStart = 0;
    this.surfaces.forEach((s, i) => {
      const o = i * INSTANCE_FLOATS;
      const count = (polys[i]?.length ?? 0) / 2;
      data.set([s.x, s.y, s.w, s.h], o);
      data.set([s.radius, s.tintAlpha, polyStart, count >= 3 ? count : 0], o + 4);
      data.set([s.tint[0], s.tint[1], s.tint[2], s.dimmed ?? 0], o + 8);
      data.set(
        [s.hovered ? 1 : 0, s.pointer?.[0] ?? 0, s.pointer?.[1] ?? 0, s.lifted ?? 0],
        o + 12,
      );
      const l = s.look;
      data.set(
        [(l?.blur ?? 0) * MAX_BLUR_LOD, l?.refraction ?? 1, l?.rim ?? 1, l?.grain ?? 1],
        o + 16,
      );
      data.set([l?.shadow ?? 1, l?.opaque ? 1 : 0, l?.borderWidth ?? 0, 0], o + 20);
      data.set(l?.borderColor ?? [0, 0, 0, 0], o + 24);
      polyStart += count;
    });
    gl.useProgram(this.glass);
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instances);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.wallpaperTex);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.polyTex);
    const u = (n: string) => gl.getUniformLocation(this.glass, n);
    gl.uniform1i(u("u_wallpaper"), 0);
    gl.uniform1i(u("u_polys"), 1);
    gl.uniform2f(u("u_viewport"), w, h);
    gl.uniform1f(u("u_margin"), SHADOW_MARGIN);
    gl.uniform2f(u("u_windowOffset"), p.offsetX, p.offsetY);
    gl.uniform2f(u("u_monitorSize"), p.monitorWidth, p.monitorHeight);
    gl.uniform1f(u("u_hasWallpaper"), this.wallpaperTex ? 1 : 0);
    gl.uniform1f(u("u_opaque"), this.opaque ? 1 : 0);
    // Grain is static between frames; only a new frame reseeds it (no flicker while idle).
    gl.uniform1f(u("u_time"), Math.floor(now / 1000) % 7);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this.surfaces.length);
    gl.bindVertexArray(null);
  }
}
