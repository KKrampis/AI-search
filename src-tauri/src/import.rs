//! Reading files picked (or dropped) for import. Parsing happens in the UI
//! (src/lib/importer.ts); this only collects text files, walking folders.

use crate::error::AppResult;
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};

const EXTENSIONS: &[&str] = &["md", "markdown", "json", "txt"];
const MAX_FILE_BYTES: u64 = 5 * 1024 * 1024;
const MAX_FILES: usize = 2000;
const MAX_DEPTH: usize = 6;

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ImportFile {
    pub path: String,
    pub name: String,
    pub content: String,
    /// Last-modified time (ms), used when a file carries no date.
    pub modified: i64,
}

#[derive(Serialize, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct ImportRead {
    pub files: Vec<ImportFile>,
    /// Files that were skipped, with the reason.
    pub skipped: Vec<String>,
}

fn wanted(p: &Path) -> bool {
    p.extension()
        .and_then(|e| e.to_str())
        .map(|e| EXTENSIONS.contains(&e.to_ascii_lowercase().as_str()))
        .unwrap_or(false)
}

fn hidden(p: &Path) -> bool {
    p.file_name().and_then(|n| n.to_str()).map(|n| n.starts_with('.')).unwrap_or(false)
}

fn collect(p: &Path, depth: usize, out: &mut Vec<PathBuf>, read: &mut ImportRead) {
    if out.len() >= MAX_FILES {
        return;
    }
    if p.is_dir() {
        if depth > MAX_DEPTH || (depth > 0 && hidden(p)) {
            return;
        }
        let mut entries: Vec<PathBuf> = match fs::read_dir(p) {
            Ok(rd) => rd.flatten().map(|e| e.path()).collect(),
            Err(e) => {
                read.skipped.push(format!("{}: {e}", p.display()));
                return;
            }
        };
        entries.sort();
        for e in entries {
            if !hidden(&e) {
                collect(&e, depth + 1, out, read);
            }
        }
    } else if wanted(p) {
        out.push(p.to_path_buf());
    } else if depth == 0 {
        read.skipped.push(format!("{}: not a .md, .json or .txt file", p.display()));
    }
}

pub fn read_files(paths: &[String]) -> AppResult<ImportRead> {
    let mut read = ImportRead::default();
    let mut found = Vec::new();
    for p in paths {
        collect(Path::new(p), 0, &mut found, &mut read);
    }
    if found.len() >= MAX_FILES {
        read.skipped.push(format!("Stopped after {MAX_FILES} files."));
    }
    for p in found {
        let meta = match fs::metadata(&p) {
            Ok(m) => m,
            Err(e) => {
                read.skipped.push(format!("{}: {e}", p.display()));
                continue;
            }
        };
        if meta.len() > MAX_FILE_BYTES {
            read.skipped.push(format!("{}: larger than 5 MB", p.display()));
            continue;
        }
        let content = match fs::read(&p) {
            Ok(b) => String::from_utf8_lossy(&b).into_owned(),
            Err(e) => {
                read.skipped.push(format!("{}: {e}", p.display()));
                continue;
            }
        };
        let modified = meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as i64)
            .unwrap_or_else(crate::model::now_ms);
        read.files.push(ImportFile {
            path: p.to_string_lossy().into_owned(),
            name: p.file_name().unwrap_or_default().to_string_lossy().into_owned(),
            content,
            modified,
        });
    }
    Ok(read)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn walks_folders_and_filters() {
        let dir = tempfile::tempdir().unwrap();
        let d = dir.path();
        fs::write(d.join("a.md"), "# A").unwrap();
        fs::write(d.join("b.json"), "{}").unwrap();
        fs::write(d.join("c.png"), "x").unwrap();
        fs::create_dir_all(d.join("sub")).unwrap();
        fs::write(d.join("sub/d.markdown"), "# D").unwrap();
        fs::create_dir_all(d.join(".git")).unwrap();
        fs::write(d.join(".git/e.md"), "no").unwrap();
        let r = read_files(&[d.to_string_lossy().into_owned()]).unwrap();
        let mut names: Vec<_> = r.files.iter().map(|f| f.name.clone()).collect();
        names.sort();
        assert_eq!(names, ["a.md", "b.json", "d.markdown"]);
        assert!(r.files.iter().all(|f| f.modified > 0));

        let single = read_files(&[d.join("c.png").to_string_lossy().into_owned()]).unwrap();
        assert!(single.files.is_empty());
        assert_eq!(single.skipped.len(), 1);
    }
}
