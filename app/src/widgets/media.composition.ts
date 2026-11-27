// Built-in Now Playing widget composition (4.10 Now Playing, brief §8.1).
// Supports Card (with blurred art backdrop & breathing Material shape mask), Vinyl, and Cassette
// looks, local synced `.lrc` lyrics, wavy seekable progress, shuffle/repeat/volume, and inline
// player switching. Kept in sync with `spec/compositions/media.json` (tested in `round3.test.ts`).
import type { Composition } from "../compose/model.gen";

const mediaParams = (size: string) => ({
  player: "mediaActive",
  players: "media.players",
  look: "opt.look",
  artShape: "opt.artShape",
  artBackdrop: "opt.artBackdrop",
  showLyrics: "opt.showLyrics",
  showExtraControls: "opt.showExtraControls",
  showArt: "mediaMeta.showArt",
  showTitle: "mediaMeta.showTitle",
  showArtist: "mediaMeta.showArtist",
  showAlbum: "mediaMeta.showAlbum",
  showApp: "mediaMeta.showApp",
  showProgress: "mediaMeta.showProgress",
  showControls: "mediaMeta.showControls",
  size,
});

export const mediaComposition: Composition = {
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
            id: "player",
            type: "canvas",
            visual: "now-playing",
            label: "Now Playing",
            params: mediaParams("'L'"),
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
            id: "player",
            type: "canvas",
            visual: "now-playing",
            label: "Now Playing",
            params: mediaParams("'M'"),
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
            id: "player",
            type: "canvas",
            visual: "now-playing",
            label: "Now Playing",
            params: mediaParams("'S'"),
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
            id: "player",
            type: "canvas",
            visual: "now-playing",
            label: "Now Playing",
            params: mediaParams("'2x1'"),
          },
        ],
      },
    },
  ],
};
