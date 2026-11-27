// Mirrors src-tauri/src/model.rs and settings.rs (camelCase over IPC).

export interface Project {
  id: string;
  name: string;
  description: string;
  instructions: string;
  color?: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface Source {
  title: string;
  url: string;
}

export type MessageStatus = "complete" | "partial" | "pending" | "error" | "stopped" | "needs_user";

export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  sources?: Source[];
  createdAt: number;
  status?: MessageStatus | null;
  note?: string | null;
  sent?: string | null;
}

export interface Conversation {
  id: string;
  title: string;
  projectId?: string | null;
  createdAt: number;
  updatedAt: number;
  starred: boolean;
  tags?: string[];
  googleUrl?: string | null;
  messages: Message[];
}

export interface Snapshot {
  projects: Project[];
  conversations: Conversation[];
  tombstones: Record<string, number>;
}

export interface LibraryPayload {
  root: string;
  snapshot: Snapshot;
  errors: string[];
}

export interface GoogleSettings {
  hl: string;
  userAgent: string;
  showWindow: boolean;
  timeoutSecs: number;
  stableMs: number;
  answerSelectors: string[];
  inputSelectors: string[];
}

export interface GithubSettings {
  enabled: boolean;
  token: string;
  owner: string;
  repo: string;
  branch: string;
  path: string;
}

export interface JsonbinSettings {
  enabled: boolean;
  masterKey: string;
  manifestBinId: string;
  chunkKb: number;
}

export type Theme = "system" | "light" | "dark" | "tokyo-night" | "slate" | "muted-gray";

export interface Settings {
  libraryPath: string;
  writeMarkdown: boolean;
  theme: Theme;
  autoSync: boolean;
  google: GoogleSettings;
  github: GithubSettings;
  jsonbin: JsonbinSettings;
}

export interface ApplyStats {
  added: number;
  updated: number;
  deleted: number;
}

export interface SyncReport {
  backend: "github" | "jsonbin";
  pulled: ApplyStats;
  pushed: number;
  removed: number;
  message: string;
  manifestBinId?: string;
  warnings?: string[];
}

export interface SyncOutcome {
  backend: "github" | "jsonbin";
  ok: boolean;
  report?: SyncReport;
  error?: string;
}

/** Events sent by the bridge script in the Google window. */
export interface GoogleReport {
  jobId: string | null;
  kind: "ready" | "submitted" | "partial" | "done" | "error" | "needs_user" | "debug";
  url?: string;
  markdown?: string;
  sources?: Source[];
  partial?: boolean;
  note?: string | null;
  code?: string;
  message?: string;
  html?: string;
  blocked?: string | null;
}

export type Route =
  | { name: "home" }
  | { name: "chat"; id: string }
  | { name: "projects" }
  | { name: "project"; id: string }
  | { name: "search"; q?: string; starred?: boolean };
