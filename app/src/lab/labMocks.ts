// Mock values for the Lab's second stage (memory … docker). Shapes follow core's providers;
// everything is fixed except what moves with `load`, so `?still` screenshots are stable.
import type { Value } from "../layer/protocol";

const n = (v: number): Value => ({ kind: "num", v });
const m = (v: Record<string, Value>): Value => ({ kind: "map", v });
const t = (v: string): Value => ({ kind: "text", v });
const b = (v: boolean): Value => ({ kind: "bool", v });
const l = (v: Value[]): Value => ({ kind: "list", v });
const missing = (reason: string): Value => ({
  kind: "missing",
  v: { state: "unavailable", reason },
});

const ART =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ff7a59"/><stop offset="1" stop-color="#5b3cc4"/></linearGradient></defs><rect width="100" height="100" fill="url(#g)"/><circle cx="50" cy="50" r="22" fill="none" stroke="#fff" stroke-opacity=".6" stroke-width="3"/></svg>',
  );

/** The Lab's moment (LAB_NOW) in ms, for events, weather and media positions. */
const NOW_MS = Date.UTC(2026, 10, 23, 9, 9, 30);
const GB = 1e9;
const HOUR = 3600e3;

export function moreMocks(load: number): Record<string, Value> {
  const used = 5.7 * GB + load * 0.02 * GB;
  return {
    "memory.usage": m({
      totalB: n(16 * GB),
      usedB: n(used),
      availableB: n(16 * GB - used),
      cachedB: n(6.2 * GB),
      buffersB: n(0.05 * GB),
      shmemB: n(1.5 * GB),
      percent: n((used / (16 * GB)) * 100),
    }),
    "memory.swap": m({ totalB: n(4.29 * GB), usedB: n(0.8 * GB), percent: n(18.6) }),
    "memory.zswap": missing("zswap-disabled"),
    "memory.zram": m({
      origDataB: n(1.2 * GB),
      comprDataB: n(0.32 * GB),
      memUsedB: n(0.35 * GB),
      ratio: n(3.75),
      devices: n(1),
    }),
    "memory.pressure": m({ some10: n(0.4), some60: n(0.2), some300: n(0.1) }),
    "memory.info": m({
      slotsUsed: n(2),
      slotsTotal: n(2),
      speedMTs: n(2933),
      ratedSpeedMTs: n(3200),
      type: t("DDR4"),
      formFactor: t("SODIMM"),
      sticks: t("2 × 8 GB"),
      manufacturer: t("SK Hynix"),
      partNumber: t("HMA81GS6DJR8N-XN"),
      maxCapacityB: n(32 * 1024 ** 3),
    }),

    "gpu.list": l([
      m({ index: n(0), name: t("UHD Graphics 630"), discrete: b(false), driver: t("i915") }),
      m({
        index: n(1),
        name: t("GeForce GTX 1660 Ti Mobile"),
        discrete: b(true),
        driver: t("nvidia"),
      }),
    ]),
    "gpu.1.state": m({ awake: b(true), pstate: t("P2"), drivesDisplay: b(true) }),
    "gpu.1.load": n(Math.min(100, load * 1.2)),
    "gpu.1.temp": n(Math.round(48 + load * 0.3)),
    "gpu.1.vram": m({ usedB: n(1.9 * 1024 ** 3), totalB: n(6 * 1024 ** 3), percent: n(31.7) }),
    "gpu.1.clocks": m({ coreMHz: n(1395), memMHz: n(5000), maxCoreMHz: n(1590) }),
    "gpu.1.power": m({ watts: n(24.6), limitW: n(60) }),
    "gpu.1.fan": m({ rpm: n(2150), percent: n(38) }),
    "gpu.1.encdec": m({ encoder: n(0), decoder: n(12) }),
    "gpu.1.engines": m({ render3d: n(Math.min(100, load * 1.2)), video: n(12), copy: n(4) }),
    "gpu.1.processes": l([m({ name: t("blender"), pid: n(4242), vramB: n(1.4 * 1024 ** 3) })]),

    "storage.drives": l([
      m({
        name: t("nvme0n1"),
        model: t("SAMSUNG MZVLQ512HALU"),
        sizeB: n(512 * GB),
        partitions: l([
          m({
            name: t("nvme0n1p2"),
            mount: t("/"),
            fs: t("ext4"),
            percent: n(43.7),
            usedB: n(208 * GB),
            availB: n(268 * GB),
            totalB: n(502 * GB),
          }),
        ]),
      }),
      m({
        name: t("sdb"),
        model: t("SanDisk Ultra"),
        sizeB: n(64 * GB),
        partitions: l([
          m({
            name: t("sdb1"),
            mount: t("/media/lab/USB"),
            fs: t("exfat"),
            percent: n(71),
            usedB: n(45 * GB),
            availB: n(19 * GB),
            totalB: n(64 * GB),
          }),
        ]),
      }),
    ]),
    "storage.io": m({ nvme0n1: m({ readBps: n(1.4e6), writeBps: n(3.1e5), busyPercent: n(4.2) }) }),
    "storage.temps": m({ nvme0n1: m({ tempC: n(39) }) }),
    "storage.health": m({
      nvme0n1: m({
        status: t("good"),
        percentUsed: n(16),
        model: t("SAMSUNG MZVLQ512HALU-000H1"),
        writtenB: n(60.2e12),
        powerOnHours: n(8007),
        warnings: l([]),
        ejectable: b(false),
        canPowerOff: b(false),
      }),
      sdb: m({
        status: t("good"),
        model: t("SanDisk Ultra"),
        warnings: l([]),
        ejectable: b(true),
        canPowerOff: b(true),
      }),
    }),

    "network.interfaces": l([
      m({ name: t("wlo1"), kind: t("wifi"), up: b(true) }),
      m({ name: t("eno1"), kind: t("ethernet"), up: b(false) }),
    ]),
    "network.primary": m({ type: t("wifi") }),
    "network.rates": m({ wlo1: m({ rxBps: n(2.4e6 + load * 4e4), txBps: n(3.1e5) }) }),
    "network.wifi": m({
      interface: t("wlo1"),
      ssid: t("Lab Wi-Fi"),
      signal: n(72),
      band: t("5 GHz"),
      bitrateMbps: n(866.7),
    }),
    "network.latency": m({ ms: n(18.4), target: t("1.1.1.1") }),
    "network.connectivity": t("full"),
    "network.vpn": m({ active: b(false), connections: l([]) }),
    "network.publicIp": missing("disabled-in-settings"),
    "network.usage": m({
      todayRxB: n(1.8 * GB),
      todayTxB: n(0.21 * GB),
      periodRxB: n(41 * GB),
      periodTxB: n(3.3 * GB),
    }),

    "power.battery": m({
      percent: n(76),
      state: t("discharging"),
      timeToEmptyS: n(3 * 3600 + 25 * 60),
      rateW: n(11.8),
      capacityPercent: n(75),
      energyWh: n(29.9),
      energyFullWh: n(39.4),
      vendor: t("Hewlett-Packard"),
      model: t("PABAS0241231"),
      cycles: missing("not-reported"),
    }),
    "power.ac": b(false),
    "power.profile": m({
      active: t("balanced"),
      available: l([t("power-saver"), t("balanced"), t("performance")]),
    }),
    "power.peripherals": l([m({ kind: t("mouse"), model: t("MX Master 3"), percent: n(64) })]),

    "fans.list": l([
      m({
        name: t("Fan 1"),
        rpm: n(Math.round(2400 + load * 10)),
        maxRpm: missing("not-reported"),
      }),
      m({ name: t("Fan 2"), rpm: n(Math.round(2200 + load * 9)), maxRpm: missing("not-reported") }),
    ]),

    "processes.apps": l([
      m({
        id: t("org.blender.Blender"),
        name: t("Blender"),
        cpu: n(38.2),
        memB: n(2.1 * GB),
        processes: n(3),
        system: b(false),
      }),
      m({
        id: t("firefox"),
        name: t("Firefox"),
        cpu: n(9.4),
        memB: n(1.6 * GB),
        processes: n(14),
        system: b(false),
      }),
      m({
        id: t("code"),
        name: t("Visual Studio Code"),
        cpu: n(4.1),
        memB: n(1.1 * GB),
        processes: n(9),
        system: b(false),
      }),
      m({
        id: t("system"),
        name: t("System"),
        cpu: n(3.2),
        memB: n(2.0 * GB),
        processes: n(344),
        system: b(true),
      }),
      m({
        id: t("org.gnome.Nautilus"),
        name: t("Files"),
        cpu: n(0.6),
        memB: n(0.2 * GB),
        processes: n(1),
        system: b(false),
      }),
    ]),
    "processes.list": l([
      m({
        app: t("org.blender.Blender"),
        name: t("blender"),
        pid: n(4242),
        start: n(1000),
        own: b(true),
        cpu: n(36.9),
        memB: n(2.0 * GB),
      }),
      m({
        app: t("firefox"),
        name: t("firefox"),
        pid: n(3100),
        start: n(900),
        own: b(true),
        cpu: n(5.2),
        memB: n(0.7 * GB),
      }),
      m({
        app: t("system"),
        name: t("gnome-shell"),
        pid: n(1800),
        start: n(10),
        own: b(true),
        cpu: n(2.1),
        memB: n(0.3 * GB),
      }),
    ]),

    "media.player": m({
      bus: t("org.mpris.MediaPlayer2.lab"),
      identity: t("Lab Player"),
      title: t("Glass Hours"),
      artists: l([t("The Opaline Ensemble")]),
      album: t("Desktop Weather"),
      art: t(ART),
      // Paused, so the Lab's still screenshots don't move.
      status: t("Paused"),
      lengthUs: n(245e6),
      positionUs: n(97e6),
      positionAtMs: n(NOW_MS),
      rate: n(1),
      canControl: b(true),
      canPlay: b(true),
      canPause: b(true),
      canNext: b(true),
      canPrevious: b(true),
      canSeek: b(true),
    }),
    "media.players": l([m({ identity: t("Lab Player"), bus: t("org.mpris.MediaPlayer2.lab") })]),
    "audio.state": m({ capturing: b(true), reason: t("playing") }),
    "audio.spectrum": m({ frames: n(0) }),

    "weather.current": m({
      location: t("Berlin"),
      tempC: n(7),
      feelsC: n(4),
      humidity: n(81),
      isDay: b(true),
      code: n(2),
      windKmh: n(17),
      windDir: n(240),
      precipMm: n(0),
      cloud: n(55),
      pressureHpa: n(1016),
      timezone: t("Europe/Berlin"),
      updatedMs: n(NOW_MS),
    }),
    "weather.hourly": l(
      Array.from({ length: 24 }, (_, i) =>
        m({
          time: t(`2026-11-23T${String(i).padStart(2, "0")}:00`),
          tempC: n(Math.round(3 + Math.sin((i - 8) / 4) * 5)),
          precipProb: n(i > 15 ? 60 : 10),
          code: n(i > 15 ? 61 : i > 12 ? 3 : 2),
          isDay: n(i >= 8 && i < 17 ? 1 : 0),
        }),
      ),
    ),
    "weather.daily": l(
      [2, 61, 3, 0, 71, 2, 45].map((code, i) =>
        m({
          date: t(`2026-11-${String(23 + i)}`),
          code: n(code),
          maxC: n(8 - i),
          minC: n(Math.round(1 - i / 2)),
          sunrise: t(`2026-11-${String(23 + i)}T07:43`),
          sunset: t(`2026-11-${String(23 + i)}T16:00`),
          precipProb: n(code > 50 ? 70 : 10),
          uv: n(1),
        }),
      ),
    ),
    "weather.air": m({ europeanAqi: n(18), usAqi: n(31), pm25: n(6), pm10: n(11) }),

    "calendar.events": l([
      m({
        title: t("Design review"),
        startMs: n(NOW_MS + 2.3 * HOUR),
        endMs: n(NOW_MS + 3.3 * HOUR),
        allDay: b(false),
        location: t("Room 2"),
        calendar: t("Work"),
        color: t("#62a0ea"),
      }),
      m({
        title: t("Dentist"),
        startMs: n(NOW_MS + 6 * HOUR),
        endMs: n(NOW_MS + 7 * HOUR),
        allDay: b(false),
        calendar: t("Personal"),
        color: t("#f66151"),
      }),
      m({
        title: t("Mum's birthday"),
        startMs: n(NOW_MS + 15 * HOUR),
        endMs: n(NOW_MS + 39 * HOUR),
        allDay: b(true),
        calendar: t("Family"),
        color: t("#c061cb"),
      }),
      m({
        title: t("Release Opaline beta"),
        startMs: n(NOW_MS + 49 * HOUR),
        endMs: n(NOW_MS + 50 * HOUR),
        allDay: b(false),
        calendar: t("Work"),
        color: t("#62a0ea"),
      }),
    ]),

    "docker.state": m({
      status: t("running"),
      endpoint: t("unix:///var/run/docker.sock"),
      version: t("29.8.2"),
    }),
    "docker.containers": l([
      m({
        id: t("a1b2c3d4e5f6"),
        name: t("n8n"),
        image: t("n8nio/n8n:latest"),
        state: t("running"),
        status: t("Up 2 hours"),
        project: t("automation"),
        cpu: n(1.4),
        memB: n(312e6),
      }),
      m({
        id: t("b2c3d4e5f6a1"),
        name: t("postgres"),
        image: t("postgres:17"),
        state: t("running"),
        status: t("Up 2 hours"),
        project: t("automation"),
        cpu: n(0.3),
        memB: n(88e6),
      }),
      m({
        id: t("c3d4e5f6a1b2"),
        name: t("redis-cache"),
        image: t("redis:8"),
        state: t("exited"),
        status: t("Exited (0) 3 days ago"),
        cpu: missing("stopped"),
        memB: missing("stopped"),
      }),
    ]),
  };
}
