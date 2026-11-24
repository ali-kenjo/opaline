fn main() {
    // Declaring the app's commands lets capabilities grant them per window (least privilege):
    // a command not listed in a window's capability can't be called from that window.
    let manifest = tauri_build::AppManifest::new().commands(&[
        "layer_attach",
        "layer_subscribe",
        "layer_command",
        "layer_set_raised",
        "layer_set_peek",
        "layer_set_edit",
        "layer_asset",
        "layer_set_input_region",
        "layer_report",
        "shell_get_state",
        "shell_update_settings",
        "shell_reset_settings",
        "shell_update_layouts",
        "shell_set_autostart",
        "shell_set_helper_enabled",
        "shell_set_shortcuts",
        "shell_export_backup",
        "shell_import_backup",
        "shell_diagnostics",
        "shell_check_updates",
        "shell_install_update",
        "shell_trigger_action",
        "shell_geocode",
        "shell_list_fonts",
        "shell_wallpaper_asset",
        "shell_close",
    ]);
    if let Err(error) =
        tauri_build::try_build(tauri_build::Attributes::new().app_manifest(manifest))
    {
        eprintln!("tauri build step failed: {error:#}");
        std::process::exit(1);
    }
}
