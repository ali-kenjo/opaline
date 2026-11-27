// Built-in Docker / Podman widget composition (4.14 Docker, brief §8.1).
// Compose-project grouping, status pills, live CPU & RAM mini bars, published port chips,
// filter pills, Start/Restart/Stop controls, and honest Docker Desktop stopped state.
// Kept in sync with `spec/compositions/docker.json` (tested in `round4.test.ts`).
import type { Composition } from "../compose/model.gen";

const dockerParams = (size: string) => ({
  state: "docker.state",
  containers: "docker.containers",
  showStopped: "opt.showStopped",
  controls: "opt.controls",
  groupByProject: "opt.groupByProject",
  binary: "opt.byteUnit == 'binary'",
  decimals: "dkMeta.decimals",
  showImage: "dkMeta.showImage",
  showCpu: "dkMeta.showCpu",
  showMemory: "dkMeta.showMemory",
  showStatus: "dkMeta.showStatus",
  size,
});

export const dockerComposition: Composition = {
  version: 1,
  layouts: [
    {
      minW: 4,
      minH: 4,
      root: {
        id: "root",
        type: "column",
        children: [
          {
            id: "panel",
            type: "canvas",
            visual: "docker-panel",
            label: "Docker",
            params: dockerParams("'L'"),
          },
        ],
      },
    },
    {
      minW: 4,
      minH: 2,
      root: {
        id: "root",
        type: "column",
        children: [
          {
            id: "panel",
            type: "canvas",
            visual: "docker-panel",
            label: "Docker",
            params: dockerParams("'M'"),
          },
        ],
      },
    },
    {
      minW: 2,
      minH: 2,
      root: {
        id: "root",
        type: "column",
        children: [
          {
            id: "panel",
            type: "canvas",
            visual: "docker-panel",
            label: "Docker",
            params: dockerParams("'S'"),
          },
        ],
      },
    },
    {
      root: {
        id: "root",
        type: "column",
        children: [
          {
            id: "panel",
            type: "canvas",
            visual: "docker-panel",
            label: "Docker",
            params: dockerParams("'4x1'"),
          },
        ],
      },
    },
  ],
};
