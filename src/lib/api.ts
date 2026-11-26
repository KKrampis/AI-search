import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  Conversation,
  GoogleReport,
  LibraryPayload,
  Project,
  Settings,
  SyncOutcome,
  SyncReport,
} from "./types";

/** Typed wrappers around the Rust commands in src-tauri/src/lib.rs. */
export const api = {
  getSettings: () => invoke<Settings>("get_settings"),
  saveSettings: (settings: Settings) => invoke<LibraryPayload>("save_settings", { settings }),
  defaultLibraryPath: () => invoke<string>("default_library_path"),

  loadLibrary: () => invoke<LibraryPayload>("load_library"),
  reloadLibrary: () => invoke<LibraryPayload>("reload_library"),
  saveProject: (project: Project) => invoke<Project>("save_project", { project }),
  deleteProject: (id: string, deleteConversations: boolean) =>
    invoke<LibraryPayload>("delete_project", { id, deleteConversations }),
  saveConversation: (conversation: Conversation) => invoke<Conversation>("save_conversation", { conversation }),
  deleteConversation: (id: string) => invoke<void>("delete_conversation", { id }),
  exportConversation: (id: string, path: string) => invoke<void>("export_conversation", { id, path }),
  revealLibrary: () => invoke<void>("reveal_library"),
  openUrl: (url: string) => invoke<void>("open_url", { url }),
  saveDebugFile: (name: string, content: string) => invoke<string>("save_debug_file", { name, content }),

  googleAsk: (request: { jobId: string; prompt: string; mode: "new" | "followup" }) =>
    invoke<void>("google_ask", { request }),
  googleCancel: () => invoke<void>("google_cancel"),
  googleShow: (visible: boolean) => invoke<void>("google_show", { visible }),
  googleHome: () => invoke<void>("google_home"),
  googleDebugDump: () => invoke<void>("google_debug_dump"),

  syncGithub: () => invoke<SyncReport>("sync_github"),
  syncJsonbin: () => invoke<SyncReport>("sync_jsonbin"),
  syncAll: () => invoke<SyncOutcome[]>("sync_all"),
};

export function onGoogleReport(cb: (r: GoogleReport) => void): Promise<UnlistenFn> {
  return listen<GoogleReport>("google-report", (e) => cb(e.payload));
}

export function errorText(e: unknown): string {
  if (typeof e === "string") return e;
  if (e instanceof Error) return e.message;
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
}
