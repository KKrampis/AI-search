//! Data model shared by the library, the sync engines and the UI.
//! Field names are camelCase on disk and over IPC.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub description: String,
    /// Optional text prepended to the first prompt of every new search in this project.
    #[serde(default)]
    pub instructions: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct Source {
    pub title: String,
    pub url: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct Message {
    pub id: String,
    /// "user" or "assistant"
    pub role: String,
    /// Markdown.
    pub content: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub sources: Vec<Source>,
    pub created_at: i64,
    /// complete | partial | pending | error | stopped | needs_user
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub status: Option<String>,
    /// Human-readable note (errors, "thread restarted", ...).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
    /// The exact text sent to Google, when it differs from `content`
    /// (project instructions or carried-over context).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sent: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct Conversation {
    pub id: String,
    pub title: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub project_id: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
    #[serde(default)]
    pub starred: bool,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tags: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub google_url: Option<String>,
    #[serde(default)]
    pub messages: Vec<Message>,
}

/// id -> deletion time (ms). Kept forever so deletions propagate through sync.
pub type Tombstones = BTreeMap<String, i64>;

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub projects: Vec<Project>,
    pub conversations: Vec<Conversation>,
    #[serde(default)]
    pub tombstones: Tombstones,
}

pub fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}
