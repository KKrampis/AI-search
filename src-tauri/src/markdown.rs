//! Human-readable Markdown mirrors of conversations (for browsing the
//! library folder or the GitHub repo) and the export format.

use crate::model::{Conversation, Project};

fn fmt_time(ms: i64) -> String {
    chrono::DateTime::from_timestamp_millis(ms)
        .map(|d| d.format("%Y-%m-%d %H:%M UTC").to_string())
        .unwrap_or_default()
}

pub fn conversation_to_markdown(c: &Conversation, project: Option<&Project>) -> String {
    let mut out = String::new();
    out.push_str("# ");
    out.push_str(c.title.trim());
    out.push_str("\n\n");

    let mut meta = vec![format!("Created {}", fmt_time(c.created_at))];
    if let Some(p) = project {
        meta.push(format!("Project: {}", p.name));
    }
    if !c.tags.is_empty() {
        meta.push(format!("Tags: {}", c.tags.join(", ")));
    }
    if c.starred {
        meta.push("Starred".into());
    }
    out.push_str(&format!("> {}\n\n", meta.join(" · ")));

    for m in &c.messages {
        if m.role == "user" {
            out.push_str("---\n\n## You\n\n");
            out.push_str(m.content.trim());
            out.push_str("\n\n");
        } else {
            out.push_str("### Google AI Mode\n\n");
            if m.content.trim().is_empty() {
                out.push_str("_(no answer captured)_\n\n");
            } else {
                out.push_str(m.content.trim());
                out.push_str("\n\n");
            }
            if let Some(note) = &m.note {
                out.push_str(&format!("_Note: {}_\n\n", note));
            }
            if !m.sources.is_empty() {
                out.push_str("**Sources**\n\n");
                for (i, s) in m.sources.iter().enumerate() {
                    let title = if s.title.trim().is_empty() { &s.url } else { &s.title };
                    out.push_str(&format!("{}. [{}]({})\n", i + 1, title.replace(['[', ']'], ""), s.url));
                }
                out.push('\n');
            }
        }
    }
    if let Some(u) = &c.google_url {
        out.push_str(&format!("---\n\n[Open in Google]({})\n", u));
    }
    out
}

pub fn project_readme(p: &Project) -> String {
    let mut out = format!("# {}\n\n", p.name.trim());
    if !p.description.trim().is_empty() {
        out.push_str(p.description.trim());
        out.push_str("\n\n");
    }
    if !p.instructions.trim().is_empty() {
        out.push_str("## Instructions\n\n");
        out.push_str(p.instructions.trim());
        out.push_str("\n");
    }
    out
}
