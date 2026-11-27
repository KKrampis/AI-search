mod error;
mod google;
mod import;
mod library;
mod markdown;
mod merge;
mod model;
mod settings;
mod sync;

use error::{AppError, AppResult};
use library::Library;
use model::{Conversation, Project, Snapshot};
use serde::Serialize;
use settings::Settings;
use std::path::PathBuf;
use std::sync::Mutex;
use sync::SyncReport;
use tauri::{AppHandle, Manager, State, WindowEvent};
use tauri_plugin_opener::OpenerExt;

pub struct AppState {
    settings_path: PathBuf,
    settings: Mutex<Settings>,
    library: Mutex<Library>,
    /// One sync at a time (std mutexes are never held across awaits).
    sync_lock: tokio::sync::Mutex<()>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryPayload {
    root: String,
    snapshot: Snapshot,
    errors: Vec<String>,
}

fn payload(lib: &Library) -> LibraryPayload {
    LibraryPayload {
        root: lib.root().to_string_lossy().to_string(),
        snapshot: lib.snapshot(),
        errors: lib.load_errors.clone(),
    }
}

// ------------------------------------------------------------- settings

#[tauri::command]
fn get_settings(state: State<AppState>) -> Settings {
    state.settings.lock().unwrap().clone()
}

#[tauri::command]
fn save_settings(state: State<AppState>, settings: Settings) -> AppResult<LibraryPayload> {
    let old = state.settings.lock().unwrap().clone();
    let mut lib = state.library.lock().unwrap();
    if old.library_dir() != settings.library_dir() {
        *lib = Library::open(settings.library_dir(), settings.write_markdown)?;
    } else if old.write_markdown != settings.write_markdown {
        lib.set_write_markdown(settings.write_markdown)?;
    }
    settings.save(&state.settings_path)?;
    *state.settings.lock().unwrap() = settings;
    Ok(payload(&lib))
}

#[tauri::command]
fn default_library_path() -> String {
    library::default_library_path().to_string_lossy().to_string()
}

// -------------------------------------------------------------- library

#[tauri::command]
fn load_library(state: State<AppState>) -> LibraryPayload {
    payload(&state.library.lock().unwrap())
}

#[tauri::command]
fn reload_library(state: State<AppState>) -> AppResult<LibraryPayload> {
    let mut lib = state.library.lock().unwrap();
    lib.scan()?;
    Ok(payload(&lib))
}

#[tauri::command]
fn save_project(state: State<AppState>, project: Project) -> AppResult<Project> {
    state.library.lock().unwrap().save_project(project)
}

#[tauri::command]
fn delete_project(state: State<AppState>, id: String, delete_conversations: bool) -> AppResult<LibraryPayload> {
    let mut lib = state.library.lock().unwrap();
    lib.delete_project(&id, delete_conversations, true)?;
    Ok(payload(&lib))
}

#[tauri::command]
fn save_conversation(state: State<AppState>, conversation: Conversation) -> AppResult<Conversation> {
    state.library.lock().unwrap().save_conversation(conversation)
}

#[tauri::command]
fn delete_conversation(state: State<AppState>, id: String) -> AppResult<()> {
    state.library.lock().unwrap().delete_conversation(&id, true)
}

#[tauri::command]
fn export_conversation(state: State<AppState>, id: String, path: String) -> AppResult<()> {
    let md = state
        .library
        .lock()
        .unwrap()
        .conversation_markdown(&id)
        .ok_or_else(|| AppError::msg("conversation not found"))?;
    std::fs::write(path, md)?;
    Ok(())
}

#[tauri::command]
fn reveal_library(app: AppHandle, state: State<AppState>) -> AppResult<()> {
    let root = state.library.lock().unwrap().root().to_string_lossy().to_string();
    app.opener().open_path(root, None::<&str>).map_err(|e| AppError::msg(e.to_string()))
}

#[tauri::command]
fn open_url(app: AppHandle, url: String) -> AppResult<()> {
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return Err(AppError::msg("only http(s) links can be opened"));
    }
    app.opener().open_url(url, None::<&str>).map_err(|e| AppError::msg(e.to_string()))
}

#[tauri::command]
fn save_debug_file(state: State<AppState>, name: String, content: String) -> AppResult<String> {
    let safe: String = name
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '.' || c == '_' { c } else { '_' })
        .collect();
    let dir = state.library.lock().unwrap().root().join(library::META_DIR).join("debug");
    std::fs::create_dir_all(&dir)?;
    let path = dir.join(safe);
    std::fs::write(&path, content)?;
    Ok(path.to_string_lossy().to_string())
}

/// Read the .md / .json / .txt files (folders are walked) chosen for import.
#[tauri::command]
async fn read_import_files(paths: Vec<String>) -> AppResult<import::ImportRead> {
    tauri::async_runtime::spawn_blocking(move || import::read_files(&paths))
        .await
        .map_err(|e| AppError::msg(e.to_string()))?
}

// --------------------------------------------------------------- google

fn google_settings(state: &State<AppState>) -> settings::GoogleSettings {
    state.settings.lock().unwrap().google.clone()
}

#[tauri::command]
fn google_ask(app: AppHandle, state: State<AppState>, request: google::AskRequest) -> AppResult<()> {
    google::ask(&app, &google_settings(&state), request)
}

#[tauri::command]
fn google_cancel(app: AppHandle) -> AppResult<()> {
    google::cancel(&app)
}

#[tauri::command]
fn google_show(app: AppHandle, state: State<AppState>, visible: bool) -> AppResult<()> {
    google::show(&app, &google_settings(&state), visible)
}

#[tauri::command]
fn google_home(app: AppHandle, state: State<AppState>) -> AppResult<()> {
    google::home(&app, &google_settings(&state))
}

#[tauri::command]
fn google_debug_dump(app: AppHandle) -> AppResult<()> {
    google::debug_dump(&app)
}

/// Called by the bridge script inside the Google window — the only command
/// that window may invoke (capabilities/google.json).
#[tauri::command]
fn bridge_report(app: AppHandle, webview: tauri::Webview, report: serde_json::Value) -> AppResult<()> {
    google::forward_report(&app, webview.label(), report)
}

// ----------------------------------------------------------------- sync

async fn run_github(state: &State<'_, AppState>) -> AppResult<SyncReport> {
    let cfg = state.settings.lock().unwrap().github.clone();
    sync::github::sync(&state.library, &cfg).await
}

async fn run_jsonbin(state: &State<'_, AppState>) -> AppResult<SyncReport> {
    let cfg = state.settings.lock().unwrap().jsonbin.clone();
    let report = sync::jsonbin::sync(&state.library, &cfg).await?;
    // Remember the manifest bin created on first sync.
    if let Some(id) = &report.manifest_bin_id {
        let mut s = state.settings.lock().unwrap();
        if s.jsonbin.manifest_bin_id != *id {
            s.jsonbin.manifest_bin_id = id.clone();
            s.save(&state.settings_path)?;
        }
    }
    Ok(report)
}

#[tauri::command]
async fn sync_github(state: State<'_, AppState>) -> AppResult<SyncReport> {
    let _g = state.sync_lock.lock().await;
    run_github(&state).await
}

#[tauri::command]
async fn sync_jsonbin(state: State<'_, AppState>) -> AppResult<SyncReport> {
    let _g = state.sync_lock.lock().await;
    run_jsonbin(&state).await
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SyncOutcome {
    backend: String,
    ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    report: Option<SyncReport>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

fn outcome(backend: &str, r: AppResult<SyncReport>) -> SyncOutcome {
    match r {
        Ok(rep) => SyncOutcome { backend: backend.into(), ok: true, report: Some(rep), error: None },
        Err(e) => SyncOutcome { backend: backend.into(), ok: false, report: None, error: Some(e.to_string()) },
    }
}

/// Sync every enabled backend in turn (GitHub first, then JSONBin).
#[tauri::command]
async fn sync_all(state: State<'_, AppState>) -> AppResult<Vec<SyncOutcome>> {
    let _g = state.sync_lock.lock().await;
    let (gh, jb) = {
        let s = state.settings.lock().unwrap();
        (s.github.enabled, s.jsonbin.enabled)
    };
    let mut out = Vec::new();
    if gh {
        out.push(outcome("github", run_github(&state).await));
    }
    if jb {
        out.push(outcome("jsonbin", run_jsonbin(&state).await));
    }
    Ok(out)
}

// ------------------------------------------------------------------ app

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let config_dir = app.path().app_config_dir()?;
            let settings_path = config_dir.join("settings.json");
            let settings = Settings::load(&settings_path);
            let library = match Library::open(settings.library_dir(), settings.write_markdown) {
                Ok(l) => l,
                Err(e) => {
                    eprintln!("cannot open library at {:?}: {e}; using the default location", settings.library_dir());
                    Library::open(library::default_library_path(), settings.write_markdown)?
                }
            };
            app.manage(AppState {
                settings_path,
                settings: Mutex::new(settings),
                library: Mutex::new(library),
                sync_lock: tokio::sync::Mutex::new(()),
            });
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                match window.label() {
                    // Keep the Google session (and its thread) alive: just hide it.
                    google::GOOGLE_LABEL => {
                        api.prevent_close();
                        let _ = window.hide();
                    }
                    google::MAIN_LABEL => window.app_handle().exit(0),
                    _ => {}
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            get_settings,
            save_settings,
            default_library_path,
            load_library,
            reload_library,
            save_project,
            delete_project,
            save_conversation,
            delete_conversation,
            export_conversation,
            reveal_library,
            open_url,
            save_debug_file,
            read_import_files,
            google_ask,
            google_cancel,
            google_show,
            google_home,
            google_debug_dump,
            bridge_report,
            sync_github,
            sync_jsonbin,
            sync_all,
        ])
        .run(tauri::generate_context!())
        .expect("error while running AI Search");
}
