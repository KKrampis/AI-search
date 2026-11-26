//! App settings, stored as JSON in the OS config dir
//! (~/.config/ai-search on Linux, ~/Library/Application Support/... on macOS).
//! The file holds API tokens, so it is written with 0600 permissions.

use crate::error::AppResult;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct GoogleSettings {
    /// Interface language passed as `hl=` (e.g. "en", "de").
    pub hl: String,
    /// Custom user agent for the Google window. Empty = engine default
    /// (on Linux a Safari UA is used, see google.rs).
    pub user_agent: String,
    /// Keep the Google window visible while searching.
    pub show_window: bool,
    pub timeout_secs: u32,
    /// How long the answer must stay unchanged before it is considered final.
    pub stable_ms: u32,
    /// CSS selectors for the answer container, tried in order.
    pub answer_selectors: Vec<String>,
    /// CSS selectors for the follow-up input box, tried in order.
    pub input_selectors: Vec<String>,
}

impl Default for GoogleSettings {
    fn default() -> Self {
        Self {
            hl: "en".into(),
            user_agent: String::new(),
            show_window: false,
            timeout_secs: 120,
            stable_ms: 3000,
            answer_selectors: vec![r#"div[data-subtree="aimc"]"#.into()],
            input_selectors: vec![
                r#"textarea[aria-label*="follow" i]"#.into(),
                r#"textarea[placeholder*="follow" i]"#.into(),
                r#"textarea[aria-label*="ask" i]"#.into(),
                r#"textarea[placeholder*="ask" i]"#.into(),
                r#"[contenteditable="true"][role="textbox"]"#.into(),
                "textarea".into(),
            ],
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct GithubSettings {
    pub enabled: bool,
    /// Fine-grained personal access token with "Contents: read and write".
    pub token: String,
    pub owner: String,
    pub repo: String,
    pub branch: String,
    /// Folder inside the repo that holds the library ("" = repo root).
    pub path: String,
}

impl Default for GithubSettings {
    fn default() -> Self {
        Self {
            enabled: false,
            token: String::new(),
            owner: String::new(),
            repo: String::new(),
            branch: "main".into(),
            path: "library".into(),
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct JsonbinSettings {
    pub enabled: bool,
    pub master_key: String,
    /// The manifest bin. Created on first sync; paste it on a second machine
    /// to sync the same library there.
    pub manifest_bin_id: String,
    /// Max size of each chunk bin. Free plan records are limited to 100 KB.
    pub chunk_kb: u32,
}

impl Default for JsonbinSettings {
    fn default() -> Self {
        Self { enabled: false, master_key: String::new(), manifest_bin_id: String::new(), chunk_kb: 90 }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    /// Library folder. Empty = default (~/Documents/AI Search).
    pub library_path: String,
    pub write_markdown: bool,
    /// "system" | "light" | "dark"
    pub theme: String,
    /// Sync automatically (on start and shortly after changes).
    pub auto_sync: bool,
    pub google: GoogleSettings,
    pub github: GithubSettings,
    pub jsonbin: JsonbinSettings,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            library_path: String::new(),
            write_markdown: true,
            theme: "system".into(),
            auto_sync: false,
            google: GoogleSettings::default(),
            github: GithubSettings::default(),
            jsonbin: JsonbinSettings::default(),
        }
    }
}

impl Settings {
    pub fn load(path: &Path) -> Settings {
        fs::read(path).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default()
    }

    pub fn save(&self, path: &Path) -> AppResult<()> {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        let tmp = path.with_extension("json.tmp");
        fs::write(&tmp, crate::library::to_json_bytes(self))?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&tmp, fs::Permissions::from_mode(0o600))?;
        }
        fs::rename(&tmp, path)?;
        Ok(())
    }

    pub fn library_dir(&self) -> PathBuf {
        let p = self.library_path.trim();
        if p.is_empty() {
            crate::library::default_library_path()
        } else if let Some(rest) = p.strip_prefix("~/") {
            dirs::home_dir().map(|h| h.join(rest)).unwrap_or_else(|| PathBuf::from(p))
        } else {
            PathBuf::from(p)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn partial_settings_fill_defaults() {
        let s: Settings = serde_json::from_str(r#"{"github":{"owner":"me"}}"#).unwrap();
        assert_eq!(s.github.owner, "me");
        assert_eq!(s.github.branch, "main");
        assert_eq!(s.google.timeout_secs, 120);
        assert!(s.write_markdown);
    }
}
