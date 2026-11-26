//! The Google AI Mode window.
//!
//! A real, persistent webview pointed at google.com — so it carries your own
//! cookies / sign-in, and you can solve a CAPTCHA in it when Google asks.
//! A small bridge script (bridge/google_bridge.js) is injected into it; that
//! script is the only thing on the page allowed to talk to the app, and only
//! through the `bridge_report` command (see capabilities/google.json).

use crate::error::{AppError, AppResult};
use crate::settings::GoogleSettings;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use serde::Deserialize;
use tauri::{AppHandle, Emitter, Manager, Url, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

pub const GOOGLE_LABEL: &str = "google";
pub const MAIN_LABEL: &str = "main";
const BRIDGE_JS: &str = include_str!("bridge/google_bridge.js");

/// WebKitGTK's default UA is often served Google's reduced "basic" page.
/// A Safari UA matches the actual engine (WebKit) and gets the full UI.
#[cfg(target_os = "linux")]
const FALLBACK_UA: Option<&str> =
    Some("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15");
#[cfg(not(target_os = "linux"))]
const FALLBACK_UA: Option<&str> = None;

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AskRequest {
    pub job_id: String,
    pub prompt: String,
    /// "new" starts a fresh AI Mode thread; "followup" continues the one on screen.
    pub mode: String,
}

fn hl(s: &GoogleSettings) -> String {
    let h = s.hl.trim();
    urlencoding::encode(if h.is_empty() { "en" } else { h }).into_owned()
}

fn parse_url(u: &str) -> AppResult<Url> {
    u.parse::<Url>().map_err(|e| AppError::msg(format!("bad url {u}: {e}")))
}

pub fn ensure_window(app: &AppHandle, s: &GoogleSettings) -> AppResult<WebviewWindow> {
    if let Some(w) = app.get_webview_window(GOOGLE_LABEL) {
        return Ok(w);
    }
    let start = parse_url(&format!("https://www.google.com/search?udm=50&hl={}", hl(s)))?;
    let mut b = WebviewWindowBuilder::new(app, GOOGLE_LABEL, WebviewUrl::External(start))
        .title("Google AI Mode — AI Search")
        .inner_size(1100.0, 820.0)
        .min_inner_size(480.0, 400.0)
        .visible(s.show_window)
        .initialization_script(BRIDGE_JS);
    let custom = s.user_agent.trim();
    if !custom.is_empty() {
        b = b.user_agent(custom);
    } else if let Some(ua) = FALLBACK_UA {
        b = b.user_agent(ua);
    }
    Ok(b.build()?)
}

pub fn ask(app: &AppHandle, s: &GoogleSettings, req: AskRequest) -> AppResult<()> {
    if req.prompt.trim().is_empty() {
        return Err(AppError::msg("empty prompt"));
    }
    let w = ensure_window(app, s)?;
    let job = serde_json::json!({
        "jobId": req.job_id,
        "prompt": req.prompt,
        "timeoutSecs": s.timeout_secs,
        "stableMs": s.stable_ms,
        "selectors": s.answer_selectors,
        "inputSelectors": s.input_selectors,
    });
    if req.mode == "followup" {
        let js = format!(
            "(function(){{var j={job};\
             if(window.__aisBridge){{window.__aisBridge.followUp(j);}}\
             else if(window.__TAURI_INTERNALS__){{window.__TAURI_INTERNALS__.invoke('bridge_report',{{report:{{jobId:j.jobId,kind:'error',code:'no_bridge',message:'The Google page is not ready.'}}}});}}}})();"
        );
        w.eval(&js)?;
    } else {
        let fragment = URL_SAFE_NO_PAD.encode(serde_json::to_vec(&job)?);
        let url = format!(
            "https://www.google.com/search?udm=50&hl={}&q={}#__ais={}",
            hl(s),
            urlencoding::encode(&req.prompt),
            fragment
        );
        w.navigate(parse_url(&url)?)?;
    }
    if s.show_window {
        let _ = w.show();
    }
    Ok(())
}

pub fn cancel(app: &AppHandle) -> AppResult<()> {
    if let Some(w) = app.get_webview_window(GOOGLE_LABEL) {
        w.eval("window.__aisBridge && window.__aisBridge.cancel();")?;
    }
    Ok(())
}

pub fn show(app: &AppHandle, s: &GoogleSettings, visible: bool) -> AppResult<()> {
    if visible {
        let w = ensure_window(app, s)?;
        w.show()?;
        let _ = w.unminimize();
        let _ = w.set_focus();
    } else if let Some(w) = app.get_webview_window(GOOGLE_LABEL) {
        w.hide()?;
    }
    Ok(())
}

pub fn home(app: &AppHandle, s: &GoogleSettings) -> AppResult<()> {
    let w = ensure_window(app, s)?;
    w.navigate(parse_url(&format!("https://www.google.com/search?udm=50&hl={}", hl(s)))?)?;
    Ok(())
}

pub fn debug_dump(app: &AppHandle) -> AppResult<()> {
    match app.get_webview_window(GOOGLE_LABEL) {
        Some(w) => Ok(w.eval("window.__aisBridge && window.__aisBridge.debugDump();")?),
        None => Err(AppError::msg("The Google window isn't open yet — run a search first.")),
    }
}

/// Forward a report from the bridge script to the app UI.
pub fn forward_report(app: &AppHandle, from_label: &str, report: serde_json::Value) -> AppResult<()> {
    if from_label != GOOGLE_LABEL {
        return Err(AppError::msg("bridge_report is only accepted from the Google window"));
    }
    app.emit_to(MAIN_LABEL, "google-report", report)?;
    Ok(())
}
