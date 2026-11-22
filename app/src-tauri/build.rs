fn main() {
    // Declaring the app's commands lets capabilities grant them per window (least privilege):
    // a command not listed in a window's capability can't be called from that window.
    let manifest = tauri_build::AppManifest::new().commands(&[
        "layer_attach",
        "layer_subscribe",
        "layer_set_input_region",
        "layer_report",
    ]);
    if let Err(error) =
        tauri_build::try_build(tauri_build::Attributes::new().app_manifest(manifest))
    {
        eprintln!("tauri build step failed: {error:#}");
        std::process::exit(1);
    }
}
