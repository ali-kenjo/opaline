// Storage drive health badges: a drive without SMART ("unknown": VM disks, most USB sticks) has
// no data, not a fault, so it shows no badge (it used to show "unknown" in the warning color).
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DriveListVisual } from "./round2Visuals";

const drives = [
  {
    name: "nvme0n1",
    model: "Fast SSD",
    partitions: [{ mount: "/", percent: 40, availB: 6e11, totalB: 1e12 }],
  },
  {
    name: "sda",
    model: "USB stick",
    partitions: [{ mount: "/media/usb", percent: 10, availB: 9e9, totalB: 1e10 }],
  },
  {
    name: "sdb",
    model: "Old disk",
    partitions: [{ mount: "/data", percent: 70, availB: 3e11, totalB: 1e12 }],
  },
];

describe("drive health badges", () => {
  it("shows OK and real problems, and nothing for drives without SMART", () => {
    const html = renderToStaticMarkup(
      <DriveListVisual
        label="Drives"
        params={{
          drives,
          health: {
            nvme0n1: { status: "good" },
            sda: { status: "unknown" },
            sdb: { status: "failing" },
          },
        }}
      />,
    );
    expect(html).toContain(">OK<");
    expect(html).toContain(">failing<");
    expect(html).not.toContain("unknown");
  });
});
