//! GitHub sync via the Git Data API — one commit per sync, no local git needed.
//!
//! The repo mirrors the library folder under `<path>/` (default `library/`),
//! so it is browsable on github.com (the .md mirrors render nicely there).
//! Files whose git blob sha already matches are neither downloaded nor uploaded.

use super::{git_blob_sha, http_client, SyncReport};
use crate::error::{AppError, AppResult};
use crate::library::{classify_path, Library, RecordRef, LIBRARY_REL};
use crate::model::*;
use crate::settings::GithubSettings;
use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;
use futures::stream::{self, StreamExt, TryStreamExt};
use reqwest::Method;
use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::sync::Mutex;

const API: &str = "https://api.github.com";
const PARALLEL: usize = 8;

struct Gh {
    client: reqwest::Client,
    repo_base: String,
    token: String,
    branch: String,
    prefix: String,
}

fn gh_message(v: &Value) -> String {
    v.get("message").and_then(|m| m.as_str()).unwrap_or("").to_string()
}

impl Gh {
    fn new(cfg: &GithubSettings) -> AppResult<Self> {
        let token = cfg.token.trim();
        let owner = cfg.owner.trim();
        let repo = cfg.repo.trim().trim_end_matches(".git");
        if token.is_empty() || owner.is_empty() || repo.is_empty() {
            return Err(AppError::msg("GitHub sync needs a token, an owner and a repository name."));
        }
        let branch = if cfg.branch.trim().is_empty() { "main" } else { cfg.branch.trim() };
        Ok(Gh {
            client: http_client(),
            repo_base: format!("{API}/repos/{owner}/{repo}"),
            token: token.to_string(),
            branch: branch.to_string(),
            prefix: cfg.path.trim().trim_matches('/').to_string(),
        })
    }

    fn full(&self, rel: &str) -> String {
        if self.prefix.is_empty() {
            rel.to_string()
        } else {
            format!("{}/{}", self.prefix, rel)
        }
    }

    fn rel<'a>(&self, full: &'a str) -> Option<&'a str> {
        if self.prefix.is_empty() {
            Some(full)
        } else {
            full.strip_prefix(&self.prefix).and_then(|r| r.strip_prefix('/'))
        }
    }

    async fn call(&self, method: Method, path: &str, body: Option<&Value>) -> AppResult<(u16, Value)> {
        let mut rb = self
            .client
            .request(method, format!("{}{}", self.repo_base, path))
            .bearer_auth(&self.token)
            .header("Accept", "application/vnd.github+json")
            .header("X-GitHub-Api-Version", "2022-11-28");
        if let Some(b) = body {
            rb = rb.json(b);
        }
        let resp = rb.send().await?;
        let status = resp.status().as_u16();
        let text = resp.text().await?;
        let v = if text.trim().is_empty() { Value::Null } else { serde_json::from_str(&text).unwrap_or(Value::String(text)) };
        Ok((status, v))
    }

    async fn ok(&self, method: Method, path: &str, body: Option<&Value>, what: &str) -> AppResult<Value> {
        let (status, v) = self.call(method, path, body).await?;
        if (200..300).contains(&status) {
            return Ok(v);
        }
        Err(AppError::msg(match status {
            401 => "GitHub rejected the token (401). Check that it is valid and not expired.".to_string(),
            403 | 404 => format!(
                "GitHub {what} failed ({status}): {}. Check the owner/repo names and that the token has \"Contents: read and write\" access to this repository.",
                gh_message(&v)
            ),
            _ => format!("GitHub {what} failed ({status}): {}", gh_message(&v)),
        }))
    }

    /// Commit sha of the sync branch, creating the branch (or the repo's first
    /// commit, for an empty repo) when needed.
    async fn head(&self) -> AppResult<String> {
        let ref_path = format!("/git/ref/heads/{}", self.branch);
        let (status, v) = self.call(Method::GET, &ref_path, None).await?;
        match status {
            200 => return sha_of(&v["object"]),
            409 => {
                // "Git Repository is empty."
                self.bootstrap().await?;
                let v = self.ok(Method::GET, &ref_path, None, "reading the branch").await?;
                return sha_of(&v["object"]);
            }
            404 => {}
            _ => return Err(AppError::msg(format!("GitHub: reading branch failed ({status}): {}", gh_message(&v)))),
        }
        // Branch missing: does the repo exist, and is it empty?
        let repo = self.ok(Method::GET, "", None, "opening the repository").await?;
        let default = repo["default_branch"].as_str().unwrap_or("main").to_string();
        let (s2, v2) = self.call(Method::GET, &format!("/git/ref/heads/{default}"), None).await?;
        if s2 == 409 || s2 == 404 {
            self.bootstrap().await?;
            let v = self.ok(Method::GET, &ref_path, None, "reading the branch").await?;
            return sha_of(&v["object"]);
        }
        if s2 != 200 {
            return Err(AppError::msg(format!("GitHub: reading default branch failed ({s2}): {}", gh_message(&v2))));
        }
        let base = sha_of(&v2["object"])?;
        self.ok(
            Method::POST,
            "/git/refs",
            Some(&json!({ "ref": format!("refs/heads/{}", self.branch), "sha": base })),
            "creating the sync branch",
        )
        .await?;
        Ok(base)
    }

    /// The Git Data API refuses to work on an empty repo; the Contents API
    /// can create the first commit.
    async fn bootstrap(&self) -> AppResult<()> {
        let content = B64.encode(crate::library::to_json_bytes(&json!({ "app": "ai-search", "format": 1 })));
        self.ok(
            Method::PUT,
            &format!("/contents/{}", self.full(LIBRARY_REL)),
            Some(&json!({ "message": "AI Search: initialize library", "content": content, "branch": self.branch })),
            "initializing the empty repository",
        )
        .await?;
        Ok(())
    }

    async fn blob(&self, sha: &str) -> AppResult<Vec<u8>> {
        let v = self.ok(Method::GET, &format!("/git/blobs/{sha}"), None, "downloading a file").await?;
        let content: String = v["content"].as_str().unwrap_or("").chars().filter(|c| !c.is_whitespace()).collect();
        B64.decode(content).map_err(|e| AppError::msg(format!("bad blob encoding: {e}")))
    }

    async fn create_blob(&self, bytes: &[u8]) -> AppResult<String> {
        let v = self
            .ok(Method::POST, "/git/blobs", Some(&json!({ "content": B64.encode(bytes), "encoding": "base64" })), "uploading a file")
            .await?;
        sha_of(&v)
    }
}

fn sha_of(v: &Value) -> AppResult<String> {
    v["sha"].as_str().map(str::to_string).ok_or_else(|| AppError::msg("GitHub response is missing a sha"))
}

pub async fn sync(lib: &Mutex<Library>, cfg: &GithubSettings) -> AppResult<SyncReport> {
    let gh = Gh::new(cfg)?;
    // A concurrent push from another machine makes the ref update fail; retry.
    for _ in 0..3 {
        if let Some(r) = sync_once(lib, &gh).await? {
            return Ok(r);
        }
    }
    Err(AppError::msg("GitHub kept changing during sync (another device syncing?). Try again."))
}

async fn sync_once(lib: &Mutex<Library>, gh: &Gh) -> AppResult<Option<SyncReport>> {
    let mut report = SyncReport { backend: "github".into(), ..Default::default() };

    // ---- remote state
    let head = gh.head().await?;
    let commit = gh.ok(Method::GET, &format!("/git/commits/{head}"), None, "reading the latest commit").await?;
    let base_tree = sha_of(&commit["tree"])?;
    let tree = gh.ok(Method::GET, &format!("/git/trees/{base_tree}?recursive=1"), None, "listing files").await?;
    if tree["truncated"].as_bool().unwrap_or(false) {
        return Err(AppError::msg("The repository is too large to list in one request. Use a dedicated repository (or folder) for the library."));
    }
    let mut remote: BTreeMap<String, String> = BTreeMap::new(); // rel -> sha
    for e in tree["tree"].as_array().cloned().unwrap_or_default() {
        if e["type"].as_str() != Some("blob") {
            continue;
        }
        let (Some(path), Some(sha)) = (e["path"].as_str(), e["sha"].as_str()) else { continue };
        if let Some(rel) = gh.rel(path) {
            if classify_path(rel).is_some() {
                remote.insert(rel.to_string(), sha.to_string());
            }
        }
    }

    // ---- pull what differs from local
    let local_files = lib.lock().unwrap().file_map();
    let wanted: Vec<(String, String, RecordRef)> = remote
        .iter()
        .filter_map(|(rel, sha)| {
            let kind = classify_path(rel)?;
            if matches!(kind, RecordRef::Mirror | RecordRef::Meta) {
                return None;
            }
            match local_files.get(rel) {
                Some((bytes, _)) if git_blob_sha(bytes) == *sha => None,
                _ => Some((rel.clone(), sha.clone(), kind)),
            }
        })
        .collect();

    let downloaded: Vec<(String, RecordRef, Vec<u8>)> = stream::iter(wanted.into_iter().map(|(rel, sha, kind)| async move {
        let bytes = gh.blob(&sha).await?;
        Ok::<_, AppError>((rel, kind, bytes))
    }))
    .buffer_unordered(PARALLEL)
    .try_collect()
    .await?;

    let mut incoming = Snapshot::default();
    for (rel, kind, bytes) in downloaded {
        let parsed: Result<(), serde_json::Error> = (|| {
            match kind {
                RecordRef::Tombstones => incoming.tombstones.extend(serde_json::from_slice::<Tombstones>(&bytes)?),
                RecordRef::Project(_) => incoming.projects.push(serde_json::from_slice::<Project>(&bytes)?),
                RecordRef::Conversation(_) => incoming.conversations.push(serde_json::from_slice::<Conversation>(&bytes)?),
                _ => {}
            }
            Ok(())
        })();
        if let Err(e) = parsed {
            report.warnings.push(format!("skipped {rel}: {e}"));
        }
    }

    // ---- merge into local, then compute what the remote should look like
    let desired = {
        let mut l = lib.lock().unwrap();
        report.pulled = l.apply_merged(&incoming)?;
        l.file_map()
    };

    let mut uploads: Vec<(String, Vec<u8>)> = Vec::new();
    for (rel, (bytes, _)) in &desired {
        if remote.get(rel).map(|s| *s != git_blob_sha(bytes)).unwrap_or(true) {
            uploads.push((rel.clone(), bytes.clone()));
        }
    }
    let deletions: Vec<String> = remote.keys().filter(|rel| !desired.contains_key(*rel)).cloned().collect();

    if uploads.is_empty() && deletions.is_empty() {
        report.message = if report.pulled.changed() > 0 {
            format!("Pulled {} change(s) from GitHub.", report.pulled.changed())
        } else {
            "Already up to date.".into()
        };
        return Ok(Some(report));
    }

    // ---- push: blobs -> tree -> commit -> move branch
    let upload_count = uploads.len();
    let mut entries: Vec<Value> = stream::iter(uploads.into_iter().map(|(rel, bytes)| async move {
        let sha = gh.create_blob(&bytes).await?;
        Ok::<_, AppError>(json!({ "path": gh.full(&rel), "mode": "100644", "type": "blob", "sha": sha }))
    }))
    .buffer_unordered(PARALLEL)
    .try_collect()
    .await?;
    for rel in &deletions {
        entries.push(json!({ "path": gh.full(rel), "mode": "100644", "type": "blob", "sha": Value::Null }));
    }

    let new_tree = gh
        .ok(Method::POST, "/git/trees", Some(&json!({ "base_tree": base_tree, "tree": entries })), "creating the commit tree")
        .await?;
    let message = format!(
        "AI Search sync: {} file(s) updated, {} removed",
        upload_count,
        deletions.len()
    );
    let new_commit = gh
        .ok(
            Method::POST,
            "/git/commits",
            Some(&json!({ "message": message, "tree": sha_of(&new_tree)?, "parents": [head] })),
            "creating the commit",
        )
        .await?;
    let new_sha = sha_of(&new_commit)?;
    let (status, v) = gh
        .call(Method::PATCH, &format!("/git/refs/heads/{}", gh.branch), Some(&json!({ "sha": new_sha, "force": false })))
        .await?;
    if status == 422 || status == 409 {
        return Ok(None); // branch moved under us: start over
    }
    if !(200..300).contains(&status) {
        return Err(AppError::msg(format!("GitHub: updating the branch failed ({status}): {}", gh_message(&v))));
    }

    report.pushed = upload_count;
    report.removed = deletions.len();
    report.message = format!(
        "Committed {} change(s) to GitHub{}.",
        upload_count + deletions.len(),
        if report.pulled.changed() > 0 { format!(" and pulled {}", report.pulled.changed()) } else { String::new() }
    );
    Ok(Some(report))
}
