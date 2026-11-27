// Built-in Weather widget composition (4.12 Weather, brief §8.1).
// Illustrated sky scene, current temp & feels-like, hourly strip with rain bars, 5–7 day
// low-to-high range forecast, wind compass, UV, humidity, AQI, and sunrise/sunset arc.
// Kept in sync with `spec/compositions/weather.json` (tested in `round4.test.ts`).
import type { Composition } from "../compose/model.gen";

const weatherParams = (size: string) => ({
  current: "weather.current",
  hourly: "weather.hourly",
  daily: "weather.daily",
  air: "weather.air",
  tempUnit: "opt.tempUnit",
  windUnit: "opt.windUnit",
  skyScene: "opt.skyScene",
  showSunArc: "opt.showSunArc",
  decimals: "wxMeta.decimals",
  showHourly: "wxMeta.showHourly",
  showDaily: "wxMeta.showDaily",
  size,
});

export const weatherComposition: Composition = {
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
            id: "scene",
            type: "canvas",
            visual: "weather-scene",
            label: "Weather",
            params: weatherParams("'L'"),
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
            id: "scene",
            type: "canvas",
            visual: "weather-scene",
            label: "Weather",
            params: weatherParams("'M'"),
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
            id: "scene",
            type: "canvas",
            visual: "weather-scene",
            label: "Weather",
            params: weatherParams("'S'"),
          },
        ],
      },
    },
    {
      minW: 2,
      minH: 1,
      root: {
        id: "root",
        type: "column",
        children: [
          {
            id: "scene",
            type: "canvas",
            visual: "weather-scene",
            label: "Weather",
            params: weatherParams("'2x1'"),
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
            id: "scene",
            type: "canvas",
            visual: "weather-scene",
            label: "Weather",
            params: weatherParams("'1x1'"),
          },
        ],
      },
    },
  ],
};
