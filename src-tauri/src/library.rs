//! The local library: a plain folder of JSON files (plus optional Markdown
//! mirrors), laid out like this:
//!
//! ```text
//! <library>/
//!   .aisearch/library.json          format marker
//!   .aisearch/deleted.json          tombstones (id -> deletedAt ms)
//!   searches/2026-11-26-how-do-tauri-capabilities-work--3f2a9c1d.json
//!   searches/2026-11-26-how-do-tauri-capabilities-work--3f2a9c1d.md
//!   projects/rust-research--8b1e2f00/project.json
//!   projects/rust-research--8b1e2f00/README.md
//!   projects/rust-research--8b1e2f00/2026-11-20-borrow-checker-tips--77aa01b2.json
//! ```
//!
//! Records are identified by the `id` inside the file, never by the file name,
//! so renames and moves between projects are just "write new path, delete old".
//! Everything is cached in memory; disk is written through on every change.

use crate::error::{AppError, AppResult};
use crate::markdown;
use crate::merge::merge_conversation;
use crate::model::*;
use serde::Serialize;
use std::collections::{BTreeMap, HashMap};
use std::fs;
use std::io::ErrorKind;
use std::path::{Path, PathBuf};

pub const META_DIR: &str = ".aisearch";
pub const TOMBSTONES_REL: &str = ".aisearch/deleted.json";
pub const LIBRARY_REL: &str = ".aisearch/library.json";
pub const PROJECTS_DIR: &str = "projects";
pub const SEARCHES_DIR: &str = "searches";
pub const PROJECT_FILE: &str = "project.json";
pub const PROJECT_README: &str = "README.md";

#[derive(Clone, Debug, PartialEq)]
pub enum RecordRef {
    Project(String),
    Conversation(String),
    Tombstones,
    Meta,
    /// Derived Markdown mirror — never parsed back.
    Mirror,
}

#[derive(Serialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ApplyStats {
    pub added: usize,
    pub updated: usize,
    pub deleted: usize,
}

impl ApplyStats {
    pub fn changed(&self) -> usize {
        self.added + self.updated + self.deleted
    }
}

pub struct Library {
    root: PathBuf,
    write_markdown: bool,
    projects: HashMap<String, Project>,
    conversations: HashMap<String, Conversation>,
    tombstones: Tombstones,
    /// project id -> relative dir ("projects/<name>--<id8>")
    project_dirs: HashMap<String, String>,
    /// conversation id -> relative json path
    conv_paths: HashMap<String, String>,
    pub load_errors: Vec<String>,
}

// ---------------------------------------------------------------- helpers

pub fn slug(s: &str, max: usize) -> String {
    let mut out = String::new();
    let mut dash = false;
    for ch in s.chars() {
        if ch.is_ascii_alphanumeric() {
            out.push(ch.to_ascii_lowercase());
            dash = false;
        } else if !dash && !out.is_empty() {
            out.push('-');
            dash = true;
        }
        if out.len() >= max {
            break;
        }
    }
    let out = out.trim_matches('-').to_string();
    if out.is_empty() {
        "untitled".into()
    } else {
        out
    }
}

fn short_id(id: &str) -> String {
    let s: String = id.chars().filter(|c| c.is_ascii_alphanumeric()).take(8).collect();
    if s.is_empty() {
        "x".into()
    } else {
        s.to_ascii_lowercase()
    }
}

fn date_prefix(ms: i64) -> String {
    chrono::DateTime::from_timestamp_millis(ms)
        .map(|d| d.format("%Y-%m-%d").to_string())
        .unwrap_or_else(|| "0000-00-00".into())
}

pub fn project_dir_rel(p: &Project) -> String {
    format!("{}/{}--{}", PROJECTS_DIR, slug(&p.name, 48), short_id(&p.id))
}

fn conv_file_base(c: &Conversation) -> String {
    format!("{}-{}--{}", date_prefix(c.created_at), slug(&c.title, 60), short_id(&c.id))
}

fn md_path_of(json_rel: &str) -> String {
    match json_rel.strip_suffix(".json") {
        Some(base) => format!("{base}.md"),
        None => format!("{json_rel}.md"),
    }
}

pub fn to_json_bytes<T: Serialize>(v: &T) -> Vec<u8> {
    let mut b = serde_json::to_vec_pretty(v).expect("model types always serialize");
    b.push(b'\n');
    b
}

fn write_atomic(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let mut tmp = path.as_os_str().to_owned();
    tmp.push(".tmp");
    let tmp = PathBuf::from(tmp);
    fs::write(&tmp, bytes)?;
    fs::rename(&tmp, path)
}

fn remove_if_exists(path: &Path) -> std::io::Result<()> {
    match fs::remove_file(path) {
        Err(e) if e.kind() == ErrorKind::NotFound => Ok(()),
        other => other,
    }
}

fn json_files_in(dir: &Path) -> Vec<PathBuf> {
    let mut out = Vec::new();
    if let Ok(rd) = fs::read_dir(dir) {
        for e in rd.flatten() {
            let p = e.path();
            if p.is_file() && p.extension().and_then(|x| x.to_str()) == Some("json") {
                out.push(p);
            }
        }
    }
    out.sort();
    out
}

// ---------------------------------------------------------------- library

impl Library {
    pub fn open(root: PathBuf, write_markdown: bool) -> AppResult<Self> {
        fs::create_dir_all(root.join(META_DIR))?;
        fs::create_dir_all(root.join(PROJECTS_DIR))?;
        fs::create_dir_all(root.join(SEARCHES_DIR))?;
        let meta = root.join(LIBRARY_REL);
        if !meta.exists() {
            write_atomic(&meta, &Self::meta_bytes())?;
        }
        let mut lib = Library {
            root,
            write_markdown,
            projects: HashMap::new(),
            conversations: HashMap::new(),
            tombstones: Tombstones::new(),
            project_dirs: HashMap::new(),
            conv_paths: HashMap::new(),
            load_errors: Vec::new(),
        };
        lib.scan()?;
        Ok(lib)
    }

    fn meta_bytes() -> Vec<u8> {
        to_json_bytes(&serde_json::json!({ "app": "ai-search", "format": 1 }))
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    pub fn abs(&self, rel: &str) -> PathBuf {
        self.root.join(rel)
    }

    /// Re-read everything from disk (picks up external edits).
    pub fn scan(&mut self) -> AppResult<()> {
        self.projects.clear();
        self.conversations.clear();
        self.project_dirs.clear();
        self.conv_paths.clear();
        self.load_errors.clear();

        let tpath = self.abs(TOMBSTONES_REL);
        self.tombstones = match fs::read(&tpath) {
            Ok(b) => serde_json::from_slice(&b).unwrap_or_else(|e| {
                self.load_errors.push(format!("{TOMBSTONES_REL}: {e}"));
                Tombstones::new()
            }),
            Err(_) => Tombstones::new(),
        };

        let mut duplicates: Vec<(String, String)> = Vec::new(); // (id, stale rel path)

        // Projects and the conversations inside them.
        let pdir = self.abs(PROJECTS_DIR);
        let mut project_entries: Vec<PathBuf> = fs::read_dir(&pdir)
            .map(|rd| rd.flatten().map(|e| e.path()).filter(|p| p.is_dir()).collect())
            .unwrap_or_default();
        project_entries.sort();
        for dir in project_entries {
            let dir_name = dir.file_name().unwrap_or_default().to_string_lossy().to_string();
            let rel_dir = format!("{PROJECTS_DIR}/{dir_name}");
            let pfile = dir.join(PROJECT_FILE);
            if pfile.exists() {
                match fs::read(&pfile).map_err(AppError::from).and_then(|b| Ok(serde_json::from_slice::<Project>(&b)?)) {
                    Ok(p) => {
                        self.project_dirs.insert(p.id.clone(), rel_dir.clone());
                        self.projects.insert(p.id.clone(), p);
                    }
                    Err(e) => self.load_errors.push(format!("{rel_dir}/{PROJECT_FILE}: {e}")),
                }
            }
            for f in json_files_in(&dir) {
                let fname = f.file_name().unwrap_or_default().to_string_lossy().to_string();
                if fname == PROJECT_FILE {
                    continue;
                }
                self.load_conversation_file(&f, format!("{rel_dir}/{fname}"), &mut duplicates);
            }
        }

        for f in json_files_in(&self.abs(SEARCHES_DIR)) {
            let fname = f.file_name().unwrap_or_default().to_string_lossy().to_string();
            self.load_conversation_file(&f, format!("{SEARCHES_DIR}/{fname}"), &mut duplicates);
        }

        // Clean up duplicates (e.g. a crash between "write new" and "delete old").
        for (id, stale) in duplicates {
            let _ = remove_if_exists(&self.abs(&stale));
            let _ = remove_if_exists(&self.abs(&md_path_of(&stale)));
            if let Some(c) = self.conversations.get(&id).cloned() {
                self.write_conversation(c)?;
            }
        }
        Ok(())
    }

    fn load_conversation_file(&mut self, abs: &Path, rel: String, dups: &mut Vec<(String, String)>) {
        let parsed = fs::read(abs)
            .map_err(AppError::from)
            .and_then(|b| Ok(serde_json::from_slice::<Conversation>(&b)?));
        match parsed {
            Ok(c) => {
                if let Some(existing) = self.conversations.get(&c.id) {
                    let merged = merge_conversation(existing, &c);
                    // Keep the path of whichever copy is newer; the other is stale.
                    let existing_path = self.conv_paths.get(&c.id).cloned().unwrap_or_default();
                    if c.updated_at > existing.updated_at {
                        dups.push((c.id.clone(), existing_path));
                        self.conv_paths.insert(c.id.clone(), rel);
                    } else {
                        dups.push((c.id.clone(), rel));
                    }
                    self.conversations.insert(c.id.clone(), merged);
                } else {
                    self.conv_paths.insert(c.id.clone(), rel);
                    self.conversations.insert(c.id.clone(), c);
                }
            }
            Err(e) => self.load_errors.push(format!("{rel}: {e}")),
        }
    }

    pub fn snapshot(&self) -> Snapshot {
        let mut projects: Vec<Project> = self.projects.values().cloned().collect();
        projects.sort_by(|a, b| a.created_at.cmp(&b.created_at).then(a.id.cmp(&b.id)));
        let mut conversations: Vec<Conversation> = self.conversations.values().cloned().collect();
        conversations.sort_by(|a, b| b.updated_at.cmp(&a.updated_at).then(a.id.cmp(&b.id)));
        Snapshot { projects, conversations, tombstones: self.tombstones.clone() }
    }

    #[cfg_attr(not(test), allow(dead_code))]
    pub fn conversation(&self, id: &str) -> Option<&Conversation> {
        self.conversations.get(id)
    }

    #[cfg_attr(not(test), allow(dead_code))]
    pub fn project(&self, id: &str) -> Option<&Project> {
        self.projects.get(id)
    }

    pub fn set_write_markdown(&mut self, on: bool) -> AppResult<()> {
        let was = self.write_markdown;
        self.write_markdown = on;
        if on && !was {
            let ids: Vec<String> = self.projects.keys().cloned().collect();
            for id in ids {
                let p = self.projects[&id].clone();
                self.write_project_files(&p)?;
            }
            let ids: Vec<String> = self.conversations.keys().cloned().collect();
            for id in ids {
                let c = self.conversations[&id].clone();
                self.write_conversation(c)?;
            }
        }
        Ok(())
    }

    fn canonical_conv_rel(&self, c: &Conversation) -> String {
        let base = conv_file_base(c);
        match c.project_id.as_ref().and_then(|pid| self.project_dirs.get(pid)) {
            Some(dir) => format!("{dir}/{base}.json"),
            None => format!("{SEARCHES_DIR}/{base}.json"),
        }
    }

    fn write_tombstones(&self) -> AppResult<()> {
        write_atomic(&self.abs(TOMBSTONES_REL), &to_json_bytes(&self.tombstones))?;
        Ok(())
    }

    fn write_project_files(&self, p: &Project) -> AppResult<()> {
        let dir = self.project_dirs.get(&p.id).cloned().unwrap_or_else(|| project_dir_rel(p));
        write_atomic(&self.abs(&format!("{dir}/{PROJECT_FILE}")), &to_json_bytes(p))?;
        if self.write_markdown {
            write_atomic(&self.abs(&format!("{dir}/{PROJECT_README}")), markdown::project_readme(p).as_bytes())?;
        }
        Ok(())
    }

    // ------------------------------------------------------------ projects

    /// Create or update a project as given (the caller sets `updated_at`).
    pub fn save_project(&mut self, p: Project) -> AppResult<Project> {
        if p.id.trim().is_empty() {
            return Err(AppError::msg("project id is empty"));
        }
        let new_dir = project_dir_rel(&p);
        if let Some(old_dir) = self.project_dirs.get(&p.id).cloned() {
            if old_dir != new_dir {
                let (from, to) = (self.abs(&old_dir), self.abs(&new_dir));
                if to.exists() {
                    return Err(AppError::msg(format!("cannot rename project: {new_dir} already exists")));
                }
                if from.exists() {
                    fs::rename(&from, &to)?;
                }
                let prefix = format!("{old_dir}/");
                for path in self.conv_paths.values_mut() {
                    if let Some(rest) = path.strip_prefix(&prefix) {
                        *path = format!("{new_dir}/{rest}");
                    }
                }
            }
        }
        self.project_dirs.insert(p.id.clone(), new_dir.clone());
        self.write_project_files(&p)?;
        self.projects.insert(p.id.clone(), p.clone());

        // Conversations that point at this project but live elsewhere
        // (e.g. synced before their project arrived) move into its folder.
        let misplaced: Vec<Conversation> = self
            .conversations
            .values()
            .filter(|c| c.project_id.as_deref() == Some(p.id.as_str()))
            .filter(|c| !self.conv_paths.get(&c.id).map(|x| x.starts_with(&format!("{new_dir}/"))).unwrap_or(false))
            .cloned()
            .collect();
        for c in misplaced {
            self.write_conversation(c)?;
        }
        Ok(p)
    }

    /// Delete a project. Its conversations are deleted too, or moved to
    /// "searches/" (unfiled) when `delete_conversations` is false.
    pub fn delete_project(&mut self, id: &str, delete_conversations: bool, tombstone: bool) -> AppResult<()> {
        let children: Vec<String> = self
            .conversations
            .values()
            .filter(|c| c.project_id.as_deref() == Some(id))
            .map(|c| c.id.clone())
            .collect();
        for cid in children {
            if delete_conversations {
                self.delete_conversation(&cid, tombstone)?;
            } else if let Some(mut c) = self.conversations.get(&cid).cloned() {
                c.project_id = None;
                c.updated_at = now_ms();
                self.write_conversation(c)?;
            }
        }
        if let Some(dir) = self.project_dirs.remove(id) {
            remove_if_exists(&self.abs(&format!("{dir}/{PROJECT_FILE}")))?;
            remove_if_exists(&self.abs(&format!("{dir}/{PROJECT_README}")))?;
            // Only removes the folder if nothing else (user files) is left in it.
            let _ = fs::remove_dir(self.abs(&dir));
        }
        self.projects.remove(id);
        if tombstone {
            self.tombstones.insert(id.to_string(), now_ms());
            self.write_tombstones()?;
        }
        Ok(())
    }

    // ------------------------------------------------------- conversations

    /// Write a conversation to its canonical path, removing any old copy.
    fn write_conversation(&mut self, c: Conversation) -> AppResult<()> {
        let rel = self.canonical_conv_rel(&c);
        if let Some(old) = self.conv_paths.get(&c.id).cloned() {
            if old != rel {
                remove_if_exists(&self.abs(&old))?;
                remove_if_exists(&self.abs(&md_path_of(&old)))?;
            }
        }
        write_atomic(&self.abs(&rel), &to_json_bytes(&c))?;
        if self.write_markdown {
            let project = c.project_id.as_ref().and_then(|pid| self.projects.get(pid));
            let md = markdown::conversation_to_markdown(&c, project);
            write_atomic(&self.abs(&md_path_of(&rel)), md.as_bytes())?;
        }
        self.conv_paths.insert(c.id.clone(), rel);
        self.conversations.insert(c.id.clone(), c);
        Ok(())
    }

    /// Create or update a conversation as given (the caller sets `updated_at`).
    pub fn save_conversation(&mut self, c: Conversation) -> AppResult<Conversation> {
        if c.id.trim().is_empty() {
            return Err(AppError::msg("conversation id is empty"));
        }
        self.write_conversation(c.clone())?;
        Ok(c)
    }

    pub fn delete_conversation(&mut self, id: &str, tombstone: bool) -> AppResult<()> {
        if let Some(rel) = self.conv_paths.remove(id) {
            remove_if_exists(&self.abs(&rel))?;
            remove_if_exists(&self.abs(&md_path_of(&rel)))?;
        }
        self.conversations.remove(id);
        if tombstone {
            self.tombstones.insert(id.to_string(), now_ms());
            self.write_tombstones()?;
        }
        Ok(())
    }

    pub fn conversation_markdown(&self, id: &str) -> Option<String> {
        let c = self.conversations.get(id)?;
        let project = c.project_id.as_ref().and_then(|pid| self.projects.get(pid));
        Some(markdown::conversation_to_markdown(c, project))
    }

    // ---------------------------------------------------------------- sync

    /// Apply a merged snapshot from a sync. Every record is re-merged with the
    /// current local state, so edits made while the sync was in flight survive.
    pub fn apply_merged(&mut self, merged: &Snapshot) -> AppResult<ApplyStats> {
        let mut stats = ApplyStats::default();

        let mut tomb_changed = false;
        for (id, t) in &merged.tombstones {
            let e = self.tombstones.entry(id.clone()).or_insert(0);
            if *t > *e {
                *e = *t;
                tomb_changed = true;
            }
        }

        for p in &merged.projects {
            match self.projects.get(&p.id) {
                None => {
                    if self.tombstones.get(&p.id).map(|t| *t >= p.updated_at).unwrap_or(false) {
                        continue;
                    }
                    self.save_project(p.clone())?;
                    stats.added += 1;
                }
                Some(cur) if cur != p && p.updated_at > cur.updated_at => {
                    self.save_project(p.clone())?;
                    stats.updated += 1;
                }
                _ => {}
            }
        }

        for c in &merged.conversations {
            match self.conversations.get(&c.id) {
                None => {
                    if self.tombstones.get(&c.id).map(|t| *t >= c.updated_at).unwrap_or(false) {
                        continue;
                    }
                    self.write_conversation(c.clone())?;
                    stats.added += 1;
                }
                Some(cur) => {
                    let m = merge_conversation(cur, c);
                    if &m != cur {
                        self.write_conversation(m)?;
                        stats.updated += 1;
                    }
                }
            }
        }

        let tombs: Vec<(String, i64)> = self.tombstones.iter().map(|(k, v)| (k.clone(), *v)).collect();
        for (id, t) in tombs {
            if self.conversations.get(&id).map(|c| c.updated_at <= t).unwrap_or(false) {
                self.delete_conversation(&id, false)?;
                stats.deleted += 1;
            }
            if self.projects.get(&id).map(|p| p.updated_at <= t).unwrap_or(false) {
                self.delete_project(&id, false, false)?;
                stats.deleted += 1;
            }
        }

        if tomb_changed {
            self.write_tombstones()?;
        }
        Ok(stats)
    }

    /// Every managed file as it should exist (relative path -> bytes), generated
    /// from memory so it is byte-identical to what `write_*` puts on disk.
    pub fn file_map(&self) -> BTreeMap<String, (Vec<u8>, RecordRef)> {
        let mut out = BTreeMap::new();
        out.insert(LIBRARY_REL.to_string(), (Self::meta_bytes(), RecordRef::Meta));
        out.insert(TOMBSTONES_REL.to_string(), (to_json_bytes(&self.tombstones), RecordRef::Tombstones));
        for p in self.projects.values() {
            let dir = self.project_dirs.get(&p.id).cloned().unwrap_or_else(|| project_dir_rel(p));
            out.insert(format!("{dir}/{PROJECT_FILE}"), (to_json_bytes(p), RecordRef::Project(p.id.clone())));
            if self.write_markdown {
                out.insert(
                    format!("{dir}/{PROJECT_README}"),
                    (markdown::project_readme(p).into_bytes(), RecordRef::Mirror),
                );
            }
        }
        for c in self.conversations.values() {
            let rel = self.conv_paths.get(&c.id).cloned().unwrap_or_else(|| self.canonical_conv_rel(c));
            if self.write_markdown {
                let project = c.project_id.as_ref().and_then(|pid| self.projects.get(pid));
                out.insert(
                    md_path_of(&rel),
                    (markdown::conversation_to_markdown(c, project).into_bytes(), RecordRef::Mirror),
                );
            }
            out.insert(rel, (to_json_bytes(c), RecordRef::Conversation(c.id.clone())));
        }
        out
    }
}

/// Classify a library-relative path (used to parse files pulled from GitHub).
pub fn classify_path(rel: &str) -> Option<RecordRef> {
    if rel == TOMBSTONES_REL {
        return Some(RecordRef::Tombstones);
    }
    if rel == LIBRARY_REL {
        return Some(RecordRef::Meta);
    }
    let parts: Vec<&str> = rel.split('/').collect();
    let is_md = rel.ends_with(".md");
    let is_json = rel.ends_with(".json");
    match parts.as_slice() {
        [SEARCHES_DIR, _f] if is_json => Some(RecordRef::Conversation(String::new())),
        [SEARCHES_DIR, _f] if is_md => Some(RecordRef::Mirror),
        [PROJECTS_DIR, _d, f] if *f == PROJECT_FILE => Some(RecordRef::Project(String::new())),
        [PROJECTS_DIR, _d, _f] if is_json => Some(RecordRef::Conversation(String::new())),
        [PROJECTS_DIR, _d, _f] if is_md => Some(RecordRef::Mirror),
        _ => None,
    }
}

pub fn default_library_path() -> PathBuf {
    dirs::document_dir()
        .or_else(dirs::home_dir)
        .unwrap_or_else(|| PathBuf::from("."))
        .join("AI Search")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn conv(id: &str, title: &str, project: Option<&str>, updated: i64) -> Conversation {
        Conversation {
            id: id.into(),
            title: title.into(),
            project_id: project.map(Into::into),
            created_at: 1_764_000_000_000,
            updated_at: updated,
            messages: vec![Message {
                id: format!("{id}-m1"),
                role: "user".into(),
                content: "hello".into(),
                created_at: 1,
                ..Default::default()
            }],
            ..Default::default()
        }
    }

    fn project(id: &str, name: &str) -> Project {
        Project { id: id.into(), name: name.into(), created_at: 1, updated_at: 1, ..Default::default() }
    }

    #[test]
    fn slugs() {
        assert_eq!(slug("Hello, World! Ünïcode", 60), "hello-world-n-code");
        assert_eq!(slug("   ", 60), "untitled");
        assert_eq!(slug("a/b\\c", 60), "a-b-c");
    }

    #[test]
    fn save_move_rename_delete_roundtrip() {
        let dir = tempfile::tempdir().unwrap();
        let mut lib = Library::open(dir.path().to_path_buf(), true).unwrap();
        lib.save_project(project("p1aaaaaaaa", "Rust Research")).unwrap();
        lib.save_conversation(conv("c1bbbbbbbb", "Borrow checker", None, 10)).unwrap();
        let rel = lib.conv_paths["c1bbbbbbbb"].clone();
        assert!(rel.starts_with("searches/") && rel.ends_with("borrow-checker--c1bbbbbb.json"));
        assert!(lib.abs(&md_path_of(&rel)).exists());

        // move into project
        let mut c = lib.conversation("c1bbbbbbbb").unwrap().clone();
        c.project_id = Some("p1aaaaaaaa".into());
        c.updated_at = 11;
        lib.save_conversation(c).unwrap();
        let rel2 = lib.conv_paths["c1bbbbbbbb"].clone();
        assert!(rel2.starts_with("projects/rust-research--p1aaaaaa/"), "{rel2}");
        assert!(!lib.abs(&rel).exists());
        assert!(!lib.abs(&md_path_of(&rel)).exists());

        // rename project moves the folder and keeps the conversation
        let mut p = lib.project("p1aaaaaaaa").unwrap().clone();
        p.name = "Rust Notes".into();
        lib.save_project(p).unwrap();
        let rel3 = lib.conv_paths["c1bbbbbbbb"].clone();
        assert!(rel3.starts_with("projects/rust-notes--p1aaaaaa/"), "{rel3}");
        assert!(lib.abs(&rel3).exists());

        // reopen from disk sees the same state
        let lib2 = Library::open(dir.path().to_path_buf(), true).unwrap();
        assert_eq!(lib2.snapshot().conversations, lib.snapshot().conversations);
        assert_eq!(lib2.snapshot().projects, lib.snapshot().projects);
        assert!(lib2.load_errors.is_empty(), "{:?}", lib2.load_errors);

        // delete project but keep conversations
        lib.delete_project("p1aaaaaaaa", false, true).unwrap();
        let c = lib.conversation("c1bbbbbbbb").unwrap();
        assert_eq!(c.project_id, None);
        assert!(lib.conv_paths["c1bbbbbbbb"].starts_with("searches/"));
        assert!(lib.tombstones.contains_key("p1aaaaaaaa"));
        assert!(!lib.abs("projects/rust-notes--p1aaaaaa").exists());

        lib.delete_conversation("c1bbbbbbbb", true).unwrap();
        assert!(lib.snapshot().conversations.is_empty());
        assert!(Library::open(dir.path().to_path_buf(), true).unwrap().snapshot().conversations.is_empty());
    }

    #[test]
    fn orphan_conversation_moves_when_project_arrives() {
        let dir = tempfile::tempdir().unwrap();
        let mut lib = Library::open(dir.path().to_path_buf(), false).unwrap();
        lib.save_conversation(conv("c2", "Orphan", Some("p2"), 5)).unwrap();
        assert!(lib.conv_paths["c2"].starts_with("searches/"));
        lib.save_project(project("p2", "Later")).unwrap();
        assert!(lib.conv_paths["c2"].starts_with("projects/later--p2/"));
    }

    #[test]
    fn apply_merged_respects_tombstones_and_newer_local() {
        let dir = tempfile::tempdir().unwrap();
        let mut lib = Library::open(dir.path().to_path_buf(), false).unwrap();
        lib.save_conversation(conv("keep", "Keep", None, 100)).unwrap();
        lib.save_conversation(conv("gone", "Gone", None, 100)).unwrap();

        let mut remote = Snapshot::default();
        let mut older = conv("keep", "Old title", None, 50);
        older.messages.push(Message { id: "remote-msg".into(), role: "assistant".into(), content: "hi".into(), created_at: 2, ..Default::default() });
        remote.conversations.push(older);
        remote.conversations.push(conv("new", "New", None, 70));
        remote.tombstones.insert("gone".into(), 200);
        remote.tombstones.insert("new-but-dead".into(), 500);
        remote.conversations.push(conv("new-but-dead", "Dead", None, 400));

        let stats = lib.apply_merged(&remote).unwrap();
        let snap = lib.snapshot();
        let keep = snap.conversations.iter().find(|c| c.id == "keep").unwrap();
        assert_eq!(keep.title, "Keep", "newer local metadata wins");
        assert_eq!(keep.messages.len(), 2, "messages are unioned");
        assert!(snap.conversations.iter().any(|c| c.id == "new"));
        assert!(!snap.conversations.iter().any(|c| c.id == "gone"));
        assert!(!snap.conversations.iter().any(|c| c.id == "new-but-dead"));
        assert_eq!(stats, ApplyStats { added: 1, updated: 1, deleted: 1 });

        // file_map is byte-identical to disk
        for (rel, (bytes, _)) in lib.file_map() {
            assert_eq!(fs::read(lib.abs(&rel)).unwrap(), bytes, "{rel}");
        }
    }

    #[test]
    fn classify() {
        assert_eq!(classify_path("searches/a.json"), Some(RecordRef::Conversation(String::new())));
        assert_eq!(classify_path("projects/x/project.json"), Some(RecordRef::Project(String::new())));
        assert_eq!(classify_path("projects/x/a.json"), Some(RecordRef::Conversation(String::new())));
        assert_eq!(classify_path("projects/x/README.md"), Some(RecordRef::Mirror));
        assert_eq!(classify_path(".aisearch/deleted.json"), Some(RecordRef::Tombstones));
        assert_eq!(classify_path("README.md"), None);
        assert_eq!(classify_path("projects/x/y/z.json"), None);
    }
}
