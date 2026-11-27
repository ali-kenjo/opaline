// Built-in Calendar widget composition (4.13 Calendar, brief §8.1).
// Mini month grid with colored event dots + interactive day filter, agenda with live countdown,
// current-time rule, all-day chips, and click-to-expand event details.
// Kept in sync with `spec/compositions/calendar.json` (tested in `round4.test.ts`).
import type { Composition } from "../compose/model.gen";

const calParams = (size: string) => ({
  events: "calendar.events",
  view: "opt.view",
  weekStart: "opt.weekStart",
  days: "opt.days",
  max: "opt.max",
  timeFormat: "opt.timeFormat",
  showAllDay: "calMeta.showAllDay",
  showColor: "calMeta.showColor",
  showLocation: "calMeta.showLocation",
  showCalendar: "calMeta.showCalendar",
  showTime: "calMeta.showTime",
  showEnd: "calMeta.showEnd",
  size,
});

export const calendarComposition: Composition = {
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
            id: "calendar",
            type: "canvas",
            visual: "calendar-view",
            label: "Calendar",
            params: calParams("'L'"),
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
            id: "calendar",
            type: "canvas",
            visual: "calendar-view",
            label: "Calendar",
            params: calParams("'M'"),
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
            id: "calendar",
            type: "canvas",
            visual: "calendar-view",
            label: "Calendar",
            params: calParams("'S'"),
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
            id: "calendar",
            type: "canvas",
            visual: "calendar-view",
            label: "Calendar",
            params: calParams("'2x1'"),
          },
        ],
      },
    },
  ],
};
