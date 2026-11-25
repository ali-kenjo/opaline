# ADR 0012: See-through glass: sharp sampling by default, true alpha as an option (spike S1)

Status: accepted · 2026-11-26 (Opaline 2.0, Phase 1)

## Context
The owner's requirement (2.0 brief §3.3): the wallpaper must stay visible through the widgets, as much as the user
wants. In 1.x every surface samples a quarter-resolution, pre-blurred wallpaper, so it is never sharp. The brief
asks to decide between (a) **true alpha**: a partly transparent tint, so the real desktop shows through the layer
window (cheap, but desktop icons show through too), and (b) **sampling a full-resolution wallpaper** at blur 0
(hides the icons, costs texture memory), and to measure the memory of a blur pyramid.

## What was built (kept as the base of glass 2.0, PLAN-2 task 1.6)
- Core renders a **sharp** variant of each monitor's wallpaper at its native resolution (logical size × scale,
  capped at 4096 px on the long side), stored as JPEG (quality 92): `wallpaper.monitors[key].sharp`.
  On this laptop: 1920 × 1080 for both monitors, 403 KB each.
- The compositor has a third texture (`u_sharp`, mipmapped) and a per-surface **see mode** (`SurfaceLook.see`):
  `sampled` (1.x), `sharp` (full-resolution texture; blur walks its mips) and `alpha` (no sample; tint and rim with
  real transparency). One pass, one draw call, as before.
- The layer loads the sharp image only while something uses it.
- Debug switch: `OPALINE_LAYER_PAGE='layer.html?glass=sharp|alpha'` (`&nobackdrop` hides the Peek/Edit backdrop);
  the Lab compares the modes at `lab.html?spike=glass` (screenshot `docs/design/s1-see-modes.png`).

## Measurements
**Memory** (debug build, Native mode, the owner's five-widget layout, both monitors, two runs each, PSS with
`scripts/memory-breakdown.sh`):

| | fresh | after 15 s of Peek |
| - | - | - |
| sampled (1.x) | 384 / 401 MB | 416 / 409 MB |
| sharp | 386 / 416 MB | 430 / 427 MB |

The sharp texture costs about **+10 to +20 MB PSS** (decoded image and upload buffers in the web process; run-to-run
noise is about ±10 MB) plus about **11 MB of GPU memory per monitor** (1920 × 1080 RGBA with mipmaps), which PSS
doesn't show. True alpha costs nothing.

**Look** (Lab, same Opaline cards over a detailed and a smooth wallpaper):
- Sampled: readable, but the wallpaper becomes a blocky blur and loses its detail.
- Sharp and true alpha look the same: the wallpaper stays crisp behind the widgets.
- On a busy wallpaper, a light tint alone makes widget text compete with the wallpaper's own detail. See-through
  depends on the legibility work of task 1.7 (text color from the local backdrop, halo, contrast warning).

## Decision
1. **Default: sharp sampling.** It hides desktop icons behind widgets (icons through a widget look broken), keeps
   refraction, rim and dispersion as part of the glass, gives one continuous blur from 0 to 100, and behaves the same
   in Native and Instant mode. The sharp texture is loaded only while a visible surface uses a low blur (so a user who
   keeps the frosted look pays nothing).
2. **True alpha is offered** as "Real transparency" (a see mode in the surface settings and a Desktop look option):
   free, but desktop icons and, during Peek, windows show through; no blur or refraction. During Peek and Edit, true
   alpha surfaces switch to sharp sampling so windows don't show through.
3. **Blur pyramid:** no separate pyramid for now. Blur 0 to about 40 walks the sharp texture's mipmaps; above that
   the shader crossfades into the existing Gaussian quarter-resolution texture and its mipmaps. If mip blockiness
   shows on real wallpapers, a GPU dual-Kawase pass per wallpaper change is the next step (measure first).
4. Opaline's default stays readable first: the see-through default is tuned together at the Phase 1 sign-off, after
   the legibility work lands.

## Consequences
- RAM: within the 450 MB budget (ADR 0009); the cost is listed in PROGRESS.
- Core writes one more file per monitor and wallpaper (≈ 0.4 MB) to `~/.cache/opaline/wallpaper/`.
- The style model gets a `see` key (P3); task 1.6 builds the blur and tint controls on top of the see modes.
