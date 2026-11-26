//! Conflict resolution shared by every sync backend.
//!
//! * Projects: last writer (highest `updatedAt`) wins.
//! * Conversations: metadata from the newer copy, messages are the union of
//!   both copies (same message id -> the newer conversation's version), so two
//!   machines that both added turns to a conversation keep all of them.
//! * Tombstones: union (latest deletion time). A record is dropped when its
//!   tombstone is at least as new as its `updatedAt` (see `Library::apply_merged`).

use crate::model::*;
use std::collections::HashSet;

pub fn merge_conversation(a: &Conversation, b: &Conversation) -> Conversation {
    if a == b {
        return a.clone();
    }
    let (newer, older) = if b.updated_at > a.updated_at { (b, a) } else { (a, b) };
    let mut out = newer.clone();
    let have: HashSet<&str> = newer.messages.iter().map(|m| m.id.as_str()).collect();
    let extra: Vec<Message> = older.messages.iter().filter(|m| !have.contains(m.id.as_str())).cloned().collect();
    if !extra.is_empty() {
        out.messages.extend(extra);
        // Stable sort keeps user->assistant order for equal timestamps.
        out.messages.sort_by_key(|m| m.created_at);
    }
    out.updated_at = a.updated_at.max(b.updated_at);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn msg(id: &str, t: i64) -> Message {
        Message { id: id.into(), role: "user".into(), content: id.into(), created_at: t, ..Default::default() }
    }

    fn conv(id: &str, updated: i64, msgs: Vec<Message>) -> Conversation {
        Conversation { id: id.into(), title: format!("t{updated}"), created_at: 0, updated_at: updated, messages: msgs, ..Default::default() }
    }

    #[test]
    fn union_of_messages_newer_metadata() {
        let a = conv("c", 10, vec![msg("m1", 1), msg("m2", 2)]);
        let b = conv("c", 20, vec![msg("m1", 1), msg("m3", 3)]);
        let m = merge_conversation(&a, &b);
        assert_eq!(m.title, "t20");
        assert_eq!(m.messages.iter().map(|m| m.id.as_str()).collect::<Vec<_>>(), ["m1", "m2", "m3"]);
        assert_eq!(merge_conversation(&b, &a), m, "merge is symmetric");
        assert_eq!(merge_conversation(&m, &a), m, "merge is idempotent");
    }

    #[test]
    fn same_message_id_takes_newer_version() {
        let mut old = msg("m1", 1);
        old.content = "partial".into();
        let mut new = msg("m1", 1);
        new.content = "complete".into();
        let m = merge_conversation(&conv("c", 1, vec![old]), &conv("c", 2, vec![new]));
        assert_eq!(m.messages[0].content, "complete");
    }
}
