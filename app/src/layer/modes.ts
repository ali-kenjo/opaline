// Peek and Edit mode switches. Inside Tauri they go through the layer process, which keeps every
// monitor's window in sync and raises or lowers the layer; standalone (Lab, tests) they only set
// the store.
import { invoke } from "@tauri-apps/api/core";
import { inTauri } from "./bridge";
import { useLayer } from "./store";

export async function setPeekActive(active: boolean): Promise<void> {
  if (!inTauri) {
    useLayer.setState({ peek: active });
    return;
  }
  await invoke("layer_set_peek", { active });
}

export async function setEditActive(active: boolean): Promise<void> {
  if (!inTauri) {
    useLayer.setState({ edit: active });
    return;
  }
  await invoke("layer_set_edit", { active });
}
