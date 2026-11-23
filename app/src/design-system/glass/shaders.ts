// The glass compositor's shaders (docs/DESIGN.md §4). One instanced quad per surface; the
// fragment shader computes the surface's signed distance (analytic rounded rect, or a polygon
// read from a data texture), then layers: wallpaper sample with edge refraction, tint, rim,
// shadows, grain and an optional border; each surface carries its own style (ADR 0011).
// Output is premultiplied alpha.

export const VERTEX = `#version 300 es
precision highp float;
layout(location = 0) in vec2 a_corner;        // unit quad 0..1
layout(location = 1) in vec4 a_rect;          // x, y, w, h (css px, window space)
layout(location = 2) in vec4 a_params;        // radius, tintAlpha, polyStart, polyCount
layout(location = 3) in vec4 a_tint;          // rgb, dimmed
layout(location = 4) in vec4 a_hover;         // hovered, pointer x, pointer y, lifted
layout(location = 5) in vec4 a_look;          // blur lod, refraction, rim, grain (1 = designed look)
layout(location = 6) in vec4 a_look2;         // shadow (1 = designed), opaque, border width px, -
layout(location = 7) in vec4 a_border;        // border rgba
uniform vec2 u_viewport;                      // css px
uniform float u_margin;                       // shadow margin, css px
out vec2 v_pos;                               // css px, window space
flat out vec4 v_rect;
flat out vec4 v_params;
flat out vec4 v_tint;
flat out vec4 v_hover;
flat out vec4 v_look;
flat out vec4 v_look2;
flat out vec4 v_border;
void main() {
  vec2 lo = a_rect.xy - u_margin;
  vec2 hi = a_rect.xy + a_rect.zw + u_margin;
  v_pos = mix(lo, hi, a_corner);
  v_rect = a_rect;
  v_params = a_params;
  v_tint = a_tint;
  v_hover = a_hover;
  v_look = a_look;
  v_look2 = a_look2;
  v_border = a_border;
  vec2 clip = v_pos / u_viewport * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
}
`;

export const FRAGMENT = `#version 300 es
precision highp float;
in vec2 v_pos;
flat in vec4 v_rect;
flat in vec4 v_params;
flat in vec4 v_tint;
flat in vec4 v_hover;
flat in vec4 v_look;
flat in vec4 v_look2;
flat in vec4 v_border;
uniform sampler2D u_wallpaper;    // quarter-res blurred wallpaper of this monitor
uniform sampler2D u_polys;        // RGBA32F: polygon vertices (x, y in surface-local css px)
uniform vec2 u_windowOffset;      // window origin inside the monitor, css px
uniform vec2 u_monitorSize;       // css px
uniform float u_hasWallpaper;
uniform float u_opaque;
uniform float u_time;
out vec4 o_color;

float sdRoundRect(vec2 p, vec2 halfSize, float r) {
  r = min(r, min(halfSize.x, halfSize.y));
  vec2 q = abs(p) - halfSize + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}

// Signed distance to a closed polygon (Inigo Quilez), vertices fetched from the data texture.
float sdPolygon(vec2 p, int start, int count) {
  ivec2 size = textureSize(u_polys, 0);
  vec2 v0 = texelFetch(u_polys, ivec2(start % size.x, start / size.x), 0).xy;
  float d = dot(p - v0, p - v0);
  float s = 1.0;
  vec2 prev = texelFetch(u_polys, ivec2((start + count - 1) % size.x, (start + count - 1) / size.x), 0).xy;
  for (int k = 0; k < 256; k++) {
    if (k >= count) break;
    int idx = start + k;
    vec2 vi = texelFetch(u_polys, ivec2(idx % size.x, idx / size.x), 0).xy;
    vec2 vj = prev;
    vec2 e = vj - vi;
    vec2 w = p - vi;
    vec2 b = w - e * clamp(dot(w, e) / dot(e, e), 0.0, 1.0);
    d = min(d, dot(b, b));
    bvec3 c = bvec3(p.y >= vi.y, p.y < vj.y, e.x * w.y > e.y * w.x);
    if (all(c) || all(not(c))) s *= -1.0;
    prev = vi;
  }
  return s * sqrt(d);
}

float surfaceDistance(vec2 local, vec2 halfSize) {
  int count = int(v_params.w);
  if (count >= 3) return sdPolygon(local + halfSize, int(v_params.z), count);
  return sdRoundRect(local, halfSize, v_params.x);
}

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}

vec3 wallpaper(vec2 windowPos) {
  if (u_hasWallpaper < 0.5) return vec3(0.12, 0.12, 0.14);
  vec2 uv = clamp((windowPos + u_windowOffset) / u_monitorSize, 0.0, 1.0);
  return textureLod(u_wallpaper, uv, v_look.x).rgb;
}

void main() {
  vec2 halfSize = v_rect.zw * 0.5;
  vec2 center = v_rect.xy + halfSize;
  vec2 local = v_pos - center;
  float d = surfaceDistance(local, halfSize);
  float lifted = v_hover.w;

  // Drop shadow (outside and under): offset down, soft.
  float shadowY = mix(8.0, 16.0, lifted);
  float shadowBlur = mix(24.0, 40.0, lifted);
  float shadowAlpha = mix(0.28, 0.36, lifted) * v_look2.x;
  float ds = surfaceDistance(local - vec2(0.0, shadowY), halfSize);
  float shadow = (1.0 - smoothstep(-shadowBlur * 0.35, shadowBlur, ds)) * shadowAlpha;

  float coverage = 1.0 - smoothstep(-0.75, 0.75, d);
  bool opaque = u_opaque > 0.5 || v_look2.y > 0.5;
  if (coverage <= 0.0 && shadow <= 0.001) discard;

  // Edge normal from the distance field.
  vec2 grad = vec2(dFdx(d), dFdy(d));
  vec2 n = length(grad) > 1e-5 ? normalize(grad) : vec2(0.0, -1.0);

  // Refraction: within ~14 px of the edge, pull the sample inward like a lens rim.
  float edge = 1.0 - smoothstep(0.0, 14.0, -d);
  vec2 refract = opaque ? vec2(0.0) : -n * edge * edge * 10.0 * v_look.y;
  vec3 bg = wallpaper(v_pos + refract);

  // Dimmed: desaturated and darker.
  float dimmed = v_tint.a;
  float grey = dot(bg, vec3(0.2126, 0.7152, 0.0722));
  bg = mix(bg, vec3(grey) * 0.82, dimmed * 0.75);

  float tintAlpha = opaque ? 1.0 : clamp(v_params.y + dimmed * 0.12 - v_hover.x * 0.04, 0.0, 1.0);
  vec3 col = mix(bg, v_tint.rgb, tintAlpha);

  // Specular rim, lit from the top left; leans toward the pointer while hovered.
  vec2 lightDir = normalize(vec2(-0.7, -0.75));
  if (v_hover.x > 0.5) {
    vec2 toPointer = v_hover.yz - center;
    if (length(toPointer) > 1.0) lightDir = normalize(mix(lightDir, normalize(toPointer), 0.35));
  }
  float rimMask = 1.0 - smoothstep(0.0, 1.6, abs(d + 0.8));
  float facing = clamp(dot(n, lightDir), 0.0, 1.0);
  float rim = rimMask * (0.10 + 0.55 * facing) * (1.0 + v_hover.x * 0.4) * (opaque ? 0.3 : 1.0) * v_look.z;
  col += vec3(rim);

  // Inner shadow along the bottom edge.
  float inner = (1.0 - smoothstep(0.0, 10.0, -d)) * clamp(n.y, 0.0, 1.0) * 0.18;
  col *= 1.0 - inner;

  // Grain against banding (2.5 %).
  col += (hash(floor(v_pos * 2.0) + u_time) - 0.5) * 0.025 * v_look.w;

  // Border (style): a crisp inside stroke of the given width and color.
  float bw = v_look2.z;
  if (bw > 0.0) {
    float stroke = (1.0 - smoothstep(bw - 0.5, bw + 0.5, -d)) * coverage;
    col = mix(col, v_border.rgb, stroke * v_border.a);
  }

  vec4 glass = vec4(col * coverage, coverage);
  vec4 shade = vec4(0.0, 0.0, 0.0, shadow * (1.0 - coverage));
  o_color = glass + shade * (1.0 - glass.a);
}
`;

export const BACKDROP_FRAGMENT = `#version 300 es
precision highp float;
in vec2 v_pos;
uniform sampler2D u_backdrop;
uniform vec2 u_windowOffset;
uniform vec2 u_monitorSize;
uniform float u_opacity;
out vec4 o_color;
void main() {
  vec2 uv = clamp((v_pos + u_windowOffset) / u_monitorSize, 0.0, 1.0);
  vec3 c = texture(u_backdrop, uv).rgb;
  o_color = vec4(c * u_opacity, u_opacity);
}
`;

export const BACKDROP_VERTEX = `#version 300 es
precision highp float;
layout(location = 0) in vec2 a_corner;
uniform vec2 u_viewport;
out vec2 v_pos;
void main() {
  v_pos = a_corner * u_viewport;
  gl_Position = vec4(a_corner.x * 2.0 - 1.0, 1.0 - a_corner.y * 2.0, 0.0, 1.0);
}
`;
