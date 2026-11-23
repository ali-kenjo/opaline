// Source color from the wallpaper thumbnail core renders (128 × 128, opaline-asset://),
// using material-color-utilities' Celebi quantizer and scorer.
import { sourceColorFromImage } from "@material/material-color-utilities";

export async function sourceFromWallpaper(url: string): Promise<number> {
  const image = new Image();
  image.decoding = "async";
  image.src = url;
  await image.decode();
  return sourceColorFromImage(image);
}
