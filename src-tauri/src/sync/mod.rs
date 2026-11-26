//! Sync backends. Both follow the same shape:
//!   1. pull remote records (skipping anything byte-identical to local),
//!   2. merge them into the local library (`Library::apply_merged`),
//!   3. push whatever now differs from the remote.

pub mod github;
pub mod jsonbin;

use crate::library::ApplyStats;
use serde::Serialize;
use sha1::{Digest, Sha1};
use std::time::Duration;

#[derive(Serialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct SyncReport {
    pub backend: String,
    /// Changes applied to the local library.
    pub pulled: ApplyStats,
    /// Files / bins uploaded.
    pub pushed: usize,
    /// Files / bins removed remotely.
    pub removed: usize,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub manifest_bin_id: Option<String>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub warnings: Vec<String>,
}

/// Git's object id for a blob: sha1("blob <len>\0<bytes>").
pub fn git_blob_sha(bytes: &[u8]) -> String {
    let mut h = Sha1::new();
    h.update(format!("blob {}\0", bytes.len()).as_bytes());
    h.update(bytes);
    hex::encode(h.finalize())
}

pub fn http_client() -> reqwest::Client {
    reqwest::Client::builder()
        .user_agent(concat!("ai-search/", env!("CARGO_PKG_VERSION")))
        .timeout(Duration::from_secs(60))
        .build()
        .expect("http client")
}

#[cfg(test)]
mod tests {
    #[test]
    fn blob_sha_matches_git() {
        // `printf 'hello\n' | git hash-object --stdin`
        assert_eq!(super::git_blob_sha(b"hello\n"), "ce013625030ba8dba906f756967f9e9ca394464a");
        assert_eq!(super::git_blob_sha(b""), "e69de29bb2d1d6434b8b29ae775ad8c2e48c5391");
    }
}
