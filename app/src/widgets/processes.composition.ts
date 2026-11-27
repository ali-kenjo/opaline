// Built-in Processes widget composition (4.9 Processes, brief §8.1).
// Uses real cached app icons, CPU / RAM / Disk I/O / GPU columns, search filter,
// Apps / Processes grouping, and confirmed End task.
// Kept in sync with `spec/compositions/processes.json` (tested in `round3.test.ts`).
import type { Composition } from "../compose/model.gen";

const baseParams = (maxRows: string, compact: string, showSearch: string) => ({
  apps: "processes.apps",
  procs: "processes.list",
  group: "opt.group",
  sort: "opt.sort",
  showSystem: "opt.showSystem",
  endTask: "opt.endTask",
  binary: "opt.byteUnit == 'binary'",
  decimals: "procMeta.decimals",
  maxRows,
  compact,
  showSearch,
  showIo: "procMeta.showIo",
  showCount: "procMeta.showCount",
  showBar: "procMeta.showBar",
  gpuLoad: "procMeta.gpuLoad",
});

export const processesComposition: Composition = {
  version: 1,
  layouts: [
    {
      sizes: ["L", "XL"],
      minW: 4,
      minH: 4,
      root: {
        id: "root",
        type: "column",
        gap: 2,
        children: [
          {
            id: "table",
            type: "canvas",
            visual: "process-table",
            label: "Processes",
            params: baseParams("min(opt.count, 8)", "false", "opt.showSearch"),
          },
        ],
      },
    },
    {
      sizes: ["M"],
      minW: 4,
      minH: 2,
      root: {
        id: "root",
        type: "column",
        gap: 1,
        children: [
          {
            id: "table",
            type: "canvas",
            visual: "process-table",
            label: "Processes",
            params: baseParams("min(opt.count, 2)", "false", "opt.showSearch"),
          },
        ],
      },
    },
    {
      sizes: ["S"],
      minW: 2,
      minH: 2,
      root: {
        id: "root",
        type: "column",
        gap: 1,
        children: [
          {
            id: "table",
            type: "canvas",
            visual: "process-table",
            label: "Processes",
            params: baseParams("min(opt.count, 3)", "true", "false"),
          },
        ],
      },
    },
    {
      sizes: ["4x1", "2x1", "1x1"],
      root: {
        id: "root",
        type: "column",
        gap: 1,
        children: [
          {
            id: "table",
            type: "canvas",
            visual: "process-table",
            label: "Processes",
            params: baseParams("2", "true", "false"),
          },
        ],
      },
    },
  ],
};
