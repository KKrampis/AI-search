fn main() {
    // Declaring the app commands makes Tauri generate `allow-<command>` permissions
    // for each of them. That lets us grant the remote Google window access to exactly
    // one command (`bridge_report`) while the local UI gets the rest.
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "get_settings",
            "save_settings",
            "default_library_path",
            "load_library",
            "reload_library",
            "save_project",
            "delete_project",
            "save_conversation",
            "delete_conversation",
            "export_conversation",
            "reveal_library",
            "open_url",
            "save_debug_file",
            "read_import_files",
            "google_ask",
            "google_cancel",
            "google_show",
            "google_home",
            "google_debug_dump",
            "bridge_report",
            "sync_github",
            "sync_jsonbin",
            "sync_all",
        ]),
    ))
    .expect("failed to run tauri-build");
}
