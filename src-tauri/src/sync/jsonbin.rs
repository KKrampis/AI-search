//! JSONBin.io sync.
//!
//! JSONBin's free plan caps each record at 100 KB, so the library is split:
//!
//!   manifest bin : { projects, tombstones, chunks: [{ id, hash, count }] }
//!   chunk bins   : { conversations: [...] }   (each <= chunk_kb)
//!
//! Conversations are packed into chunks in creation order, so new searches
//! usually only touch the last chunk. A chunk is only downloaded when its
//! hash differs from the same chunk built locally, and only uploaded when
//! the locally built chunk differs from the remote one — this keeps the
//! request count (JSONBin bills per request) low.

use super::{http_client, SyncReport};
use crate::error::{AppError, AppResult};
use crate::library::Library;
use crate::model::*;
use crate::settings::JsonbinSettings;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::sync::Mutex;

const API: &str = "https://api.jsonbin.io/v3";
const APP: &str = "ai-search";

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct ChunkRef {
    pub id: String,
    pub hash: String,
    pub count: usize,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
struct Manifest {
    app: String,
    kind: String,
    format: u32,
    #[serde(default)]
    updated_at: i64,
    #[serde(default)]
    projects: Vec<Project>,
    #[serde(default)]
    tombstones: Tombstones,
    #[serde(default)]
    chunks: Vec<ChunkRef>,
}

#[derive(Deserialize)]
struct Chunk {
    #[serde(default)]
    conversations: Vec<Conversation>,
}

pub struct Packed {
    pub bytes: Vec<u8>,
    pub hash: String,
    pub count: usize,
}

fn sha256(b: &[u8]) -> String {
    hex::encode(Sha256::digest(b))
}

/// Greedily pack conversations (creation order) into chunks of at most `limit` bytes.
pub fn pack(conversations: &[Conversation], limit: usize) -> AppResult<Vec<Packed>> {
    const WRAP: usize = 64; // {"app":"ai-search","kind":"chunk","conversations":[...]}
    let mut sorted: Vec<&Conversation> = conversations.iter().collect();
    sorted.sort_by(|a, b| a.created_at.cmp(&b.created_at).then(a.id.cmp(&b.id)));

    let finish = |parts: &mut Vec<String>, out: &mut Vec<Packed>| {
        if parts.is_empty() {
            return;
        }
        let bytes = format!("{{\"app\":\"{APP}\",\"kind\":\"chunk\",\"conversations\":[{}]}}", parts.join(",")).into_bytes();
        out.push(Packed { hash: sha256(&bytes), count: parts.len(), bytes });
        parts.clear();
    };

    let mut out = Vec::new();
    let mut parts: Vec<String> = Vec::new();
    let mut size = WRAP;
    for c in sorted {
        let s = serde_json::to_string(c)?;
        if s.len() + WRAP > limit {
            return Err(AppError::msg(format!(
                "The conversation \"{}\" is {} KB, larger than the {} KB JSONBin chunk limit. Raise the chunk size (paid plans) or use GitHub sync.",
                c.title,
                s.len() / 1024,
                limit / 1024
            )));
        }
        if size + s.len() + 1 > limit {
            finish(&mut parts, &mut out);
            size = WRAP;
        }
        size += s.len() + 1;
        parts.push(s);
    }
    finish(&mut parts, &mut out);
    Ok(out)
}

struct Jb {
    client: reqwest::Client,
    key: String,
}

impl Jb {
    async fn check(resp: reqwest::Response, what: &str) -> AppResult<serde_json::Value> {
        let status = resp.status().as_u16();
        let text = resp.text().await?;
        let v: serde_json::Value = serde_json::from_str(&text).unwrap_or(serde_json::Value::String(text));
        if (200..300).contains(&status) {
            return Ok(v);
        }
        let msg = v.get("message").and_then(|m| m.as_str()).map(str::to_string).unwrap_or_else(|| v.to_string());
        Err(AppError::msg(match status {
            401 => format!("JSONBin rejected the key while {what} (401): {msg}"),
            404 => format!("JSONBin bin not found while {what} (404): {msg}"),
            _ => format!("JSONBin error while {what} ({status}): {msg}"),
        }))
    }

    async fn read(&self, id: &str) -> AppResult<serde_json::Value> {
        let resp = self
            .client
            .get(format!("{API}/b/{id}/latest"))
            .header("X-Master-Key", &self.key)
            .header("X-Bin-Meta", "false")
            .send()
            .await?;
        Self::check(resp, "reading").await
    }

    async fn create(&self, name: &str, body: Vec<u8>) -> AppResult<String> {
        let resp = self
            .client
            .post(format!("{API}/b"))
            .header("X-Master-Key", &self.key)
            .header("Content-Type", "application/json")
            .header("X-Bin-Private", "true")
            .header("X-Bin-Name", name)
            .body(body)
            .send()
            .await?;
        let v = Self::check(resp, "creating a bin").await?;
        v["metadata"]["id"]
            .as_str()
            .map(str::to_string)
            .ok_or_else(|| AppError::msg("JSONBin did not return a bin id"))
    }

    async fn update(&self, id: &str, body: Vec<u8>) -> AppResult<()> {
        let resp = self
            .client
            .put(format!("{API}/b/{id}"))
            .header("X-Master-Key", &self.key)
            .header("Content-Type", "application/json")
            .body(body)
            .send()
            .await?;
        Self::check(resp, "updating a bin").await.map(|_| ())
    }

    async fn delete(&self, id: &str) -> AppResult<()> {
        let resp = self.client.delete(format!("{API}/b/{id}")).header("X-Master-Key", &self.key).send().await?;
        Self::check(resp, "deleting a bin").await.map(|_| ())
    }
}

pub async fn sync(lib: &Mutex<Library>, cfg: &JsonbinSettings) -> AppResult<SyncReport> {
    let key = cfg.master_key.trim();
    if key.is_empty() {
        return Err(AppError::msg("JSONBin sync needs your X-Master-Key (jsonbin.io → API Keys)."));
    }
    let jb = Jb { client: http_client(), key: key.to_string() };
    let limit = (cfg.chunk_kb.clamp(10, 10_000) as usize) * 1024;
    let mut report = SyncReport { backend: "jsonbin".into(), ..Default::default() };

    // ---- pull
    let manifest_id = cfg.manifest_bin_id.trim().to_string();
    let local_chunks = {
        let snap = lib.lock().unwrap().snapshot();
        pack(&snap.conversations, limit)?
    };
    let mut remote_manifest: Option<Manifest> = None;
    let mut incoming = Snapshot::default();
    if !manifest_id.is_empty() {
        let v = jb.read(&manifest_id).await?;
        let m: Manifest = serde_json::from_value(v)
            .map_err(|e| AppError::msg(format!("Bin {manifest_id} is not an AI Search manifest: {e}")))?;
        if m.app != APP || m.kind != "manifest" {
            return Err(AppError::msg(format!("Bin {manifest_id} is not an AI Search manifest.")));
        }
        incoming.projects = m.projects.clone();
        incoming.tombstones = m.tombstones.clone();
        for (i, ch) in m.chunks.iter().enumerate() {
            if local_chunks.get(i).map(|l| l.hash == ch.hash).unwrap_or(false) {
                continue; // identical to what we have
            }
            let v = jb.read(&ch.id).await?;
            match serde_json::from_value::<Chunk>(v) {
                Ok(c) => incoming.conversations.extend(c.conversations),
                Err(e) => report.warnings.push(format!("skipped chunk {}: {e}", ch.id)),
            }
        }
        remote_manifest = Some(m);
    }

    let snap = {
        let mut l = lib.lock().unwrap();
        report.pulled = l.apply_merged(&incoming)?;
        l.snapshot()
    };

    // ---- push chunks
    let packed = pack(&snap.conversations, limit)?;
    let old_chunks: Vec<ChunkRef> = remote_manifest.as_ref().map(|m| m.chunks.clone()).unwrap_or_default();
    let mut new_chunks: Vec<ChunkRef> = Vec::new();
    for (i, p) in packed.into_iter().enumerate() {
        match old_chunks.get(i) {
            Some(old) if old.hash == p.hash => new_chunks.push(old.clone()),
            Some(old) => {
                jb.update(&old.id, p.bytes).await?;
                report.pushed += 1;
                new_chunks.push(ChunkRef { id: old.id.clone(), hash: p.hash, count: p.count });
            }
            None => {
                let id = jb.create(&format!("ai-search-chunk-{}", i + 1), p.bytes).await?;
                report.pushed += 1;
                new_chunks.push(ChunkRef { id, hash: p.hash, count: p.count });
            }
        }
    }
    for old in old_chunks.iter().skip(new_chunks.len()) {
        match jb.delete(&old.id).await {
            Ok(()) => report.removed += 1,
            Err(e) => report.warnings.push(format!("couldn't delete old chunk {}: {e}", old.id)),
        }
    }

    // ---- push manifest (only if something in it changed)
    let manifest = Manifest {
        app: APP.into(),
        kind: "manifest".into(),
        format: 1,
        updated_at: now_ms(),
        projects: snap.projects.clone(),
        tombstones: snap.tombstones.clone(),
        chunks: new_chunks,
    };
    let unchanged = remote_manifest
        .as_ref()
        .map(|m| m.projects == manifest.projects && m.tombstones == manifest.tombstones && m.chunks == manifest.chunks)
        .unwrap_or(false);
    let body = serde_json::to_vec(&manifest)?;
    if body.len() > limit {
        return Err(AppError::msg(format!(
            "The JSONBin manifest ({} KB of projects and deletion records) exceeds the {} KB limit.",
            body.len() / 1024,
            limit / 1024
        )));
    }
    let final_id = if manifest_id.is_empty() {
        report.pushed += 1;
        jb.create("ai-search-manifest", body).await?
    } else {
        if !unchanged {
            jb.update(&manifest_id, body).await?;
            report.pushed += 1;
        }
        manifest_id
    };
    report.manifest_bin_id = Some(final_id);
    report.message = match (report.pulled.changed(), report.pushed) {
        (0, 0) => "Already up to date.".into(),
        (p, 0) => format!("Pulled {p} change(s) from JSONBin."),
        (0, u) => format!("Uploaded {u} bin(s) to JSONBin."),
        (p, u) => format!("Pulled {p} change(s) and uploaded {u} bin(s)."),
    };
    Ok(report)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn conv(id: &str, created: i64, body: usize) -> Conversation {
        Conversation {
            id: id.into(),
            title: id.into(),
            created_at: created,
            updated_at: created,
            messages: vec![Message { id: "m".into(), role: "user".into(), content: "x".repeat(body), created_at: created, ..Default::default() }],
            ..Default::default()
        }
    }

    #[test]
    fn packs_within_limit_and_is_deterministic() {
        let convs: Vec<Conversation> = (0..20).map(|i| conv(&format!("c{i:02}"), i, 3000)).collect();
        let a = pack(&convs, 10 * 1024).unwrap();
        assert!(a.len() >= 6);
        assert!(a.iter().all(|p| p.bytes.len() <= 10 * 1024));
        assert_eq!(a.iter().map(|p| p.count).sum::<usize>(), 20);
        let mut rev = convs.clone();
        rev.reverse();
        let b = pack(&rev, 10 * 1024).unwrap();
        assert_eq!(a.iter().map(|p| &p.hash).collect::<Vec<_>>(), b.iter().map(|p| &p.hash).collect::<Vec<_>>());
        // chunks parse back
        let back: Chunk = serde_json::from_slice(&a[0].bytes).unwrap();
        assert_eq!(back.conversations[0].id, "c00");
    }

    #[test]
    fn appending_only_touches_last_chunk() {
        let mut convs: Vec<Conversation> = (0..10).map(|i| conv(&format!("c{i}"), i, 2000)).collect();
        let a = pack(&convs, 8 * 1024).unwrap();
        convs.push(conv("new", 100, 100));
        let b = pack(&convs, 8 * 1024).unwrap();
        for i in 0..a.len() - 1 {
            assert_eq!(a[i].hash, b[i].hash);
        }
    }

    #[test]
    fn oversized_conversation_is_an_error() {
        assert!(pack(&[conv("big", 0, 20_000)], 10 * 1024).is_err());
    }
}
