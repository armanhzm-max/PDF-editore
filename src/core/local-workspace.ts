export type WorkspaceKind = "word" | "excel" | "ppt" | "documents";

export type WorkspaceSummary = {
  id: string;
  kind: WorkspaceKind;
  name: string;
  preview: string;
  createdAt: number;
  updatedAt: number;
  bytes: number;
};

import { deleteWorkspaceDraftSnapshot, readWorkspaceDraftFilesFromFolder, writeWorkspaceDraftSnapshot, type DraftSnapshotRecord, type FolderWriteResult } from "./device-folder.js";
import type { Plan } from "./types";
import { getPlanLimits } from "./entitlements.js";

export type WorkspaceRecord = WorkspaceSummary & { payloadJson: string };
const DB_NAME = "pdf-ai-tools-local-workspace";
const DB_VERSION = 1;
const STORE = "records";
const FALLBACK_KEY = "pdat.local.workspace.v1";
// Backwards-compatible Pro ceilings for older modules; active operations use getWorkspaceLimits().
export const MAX_RECORD_BYTES = 4 * 1024 * 1024;
export const MAX_RECORDS = 40;
export const MAX_TOTAL_RECORD_BYTES = 60 * 1024 * 1024;
export const MAX_BACKUP_BYTES = 25 * 1024 * 1024;
const MAX_FALLBACK_BYTES = 3.5 * 1024 * 1024;
let activeWorkspacePlan: Plan = "free";
export function setWorkspacePlan(plan: Plan): void { activeWorkspacePlan = plan; }
export function getWorkspaceLimits(plan: Plan = activeWorkspacePlan) { return getPlanLimits(plan).workspace; }

export function createWorkspaceId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `local-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") return reject(new Error("workspace_storage_unavailable"));
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: "id" });
        store.createIndex("updatedAt", "updatedAt", { unique: false });
        store.createIndex("kind", "kind", { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("workspace_storage_failed"));
    request.onblocked = () => reject(new Error("workspace_storage_blocked"));
  });
}

function readFallback(): WorkspaceRecord[] {
  try {
    const value = localStorage.getItem(FALLBACK_KEY);
    const parsed = value ? JSON.parse(value) : [];
    return Array.isArray(parsed) ? parsed.filter(isRecord) : [];
  } catch { return []; }
}
function writeFallback(records: WorkspaceRecord[]): void {
  const bounded: WorkspaceRecord[] = [];
  let total = 0;
  const latestId = records[0]?.id;
  for (const record of records.slice(0, MAX_RECORDS)) {
    const size = new TextEncoder().encode(record.payloadJson).byteLength;
    if (size > MAX_FALLBACK_BYTES || total + size > MAX_FALLBACK_BYTES) continue;
    bounded.push(record);
    total += size;
  }
  if (latestId && !bounded.some((record) => record.id === latestId)) throw new Error("workspace_storage_full");
  try { localStorage.setItem(FALLBACK_KEY, JSON.stringify(bounded)); }
  catch { throw new Error("workspace_storage_full"); }
}
function isKind(value: unknown): value is WorkspaceKind {
  return value === "word" || value === "excel" || value === "ppt" || value === "documents";
}
function isRecord(value: unknown): value is WorkspaceRecord {
  if (!value || typeof value !== "object") return false;
  const v = value as Partial<WorkspaceRecord>;
  return typeof v.id === "string" && v.id.length > 0 && v.id.length <= 100 &&
    isKind(v.kind) && typeof v.name === "string" && v.name.length <= 140 &&
    typeof v.preview === "string" && typeof v.payloadJson === "string" &&
    typeof v.updatedAt === "number" && Number.isFinite(v.updatedAt) &&
    typeof v.createdAt === "number" && Number.isFinite(v.createdAt) &&
    typeof v.bytes === "number" && Number.isFinite(v.bytes) && v.bytes >= 0;
}
function safeText(value: string, max: number): string { return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").slice(0, max); }
function previewFor(kind: WorkspaceKind, payloadJson: string): string {
  try {
    const payload = JSON.parse(payloadJson) as Record<string, unknown>;
    if (kind === "word" && typeof payload.html === "string") return safeText(payload.html.replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " "), 180);
    if (kind === "excel" && Array.isArray(payload.grid)) return safeText((payload.grid as unknown[][]).slice(0, 3).map((row) => row.slice(0, 5).join(" · ")).join(" | "), 180);
    if (kind === "ppt" && Array.isArray(payload.slides)) return safeText((payload.slides as Array<{ title?: string }>).slice(0, 5).map((slide) => slide.title ?? "").filter(Boolean).join(" · "), 180);
    if (kind === "documents" && Array.isArray(payload.documents)) return safeText((payload.documents as Array<{ name?: string; format?: string }>).map((doc) => `${doc.name ?? ""} ${doc.format ?? ""}`).join(" · "), 180);
  } catch { /* Use a safe opaque preview below. */ }
  return safeText(payloadJson.replace(/[{}\[\]"\\]/g, " ").replace(/\s+/g, " "), 180);
}

function mergeRecords(primary: WorkspaceRecord[], fallback: WorkspaceRecord[] = readFallback()): WorkspaceRecord[] {
  const byId = new Map<string, WorkspaceRecord>();
  for (const record of [...primary, ...fallback]) {
    const existing = byId.get(record.id);
    if (!existing || record.updatedAt > existing.updatedAt) byId.set(record.id, record);
  }
  return [...byId.values()].sort((a, b) => b.updatedAt - a.updatedAt);
}

async function getRecordRaw(id: string): Promise<WorkspaceRecord | null> {
  try {
    const db = await openDb();
    const record = await new Promise<WorkspaceRecord | null>((resolve, reject) => {
      const request = db.transaction(STORE, "readonly").objectStore(STORE).get(id);
      request.onsuccess = () => resolve(isRecord(request.result) ? request.result : null);
      request.onerror = () => reject(request.error);
    }).finally(() => db.close());
    return record ?? readFallback().find((item) => item.id === id) ?? null;
  } catch { return readFallback().find((item) => item.id === id) ?? null; }
}

export async function saveWorkspaceItem(kind: WorkspaceKind, name: string, payload: unknown, id = createWorkspaceId()): Promise<WorkspaceSummary> {
  let payloadJson: string;
  try { payloadJson = JSON.stringify(payload); } catch { throw new Error("workspace_invalid_data"); }
  if (typeof payloadJson !== "string") throw new Error("workspace_invalid_data");
  const bytes = new TextEncoder().encode(payloadJson).byteLength;
  const limits = getWorkspaceLimits();
  const currentRecords = await allRecords();
  const previous = currentRecords.find((item) => item.id === id) ?? null;
  const projectedCount = currentRecords.length + (previous ? 0 : 1);
  const projectedBytes = currentRecords.reduce((sum, item) => sum + item.bytes, 0) - (previous?.bytes ?? 0) + bytes;
  // Downgrades never delete or lock existing drafts: an existing item may still be
  // updated in place when its size does not grow. New items and quota growth are capped.
  if (!previous && projectedCount > limits.maxRecords) throw new Error("workspace_plan_limit");
  if (bytes > limits.maxRecordBytes && (!previous || bytes > previous.bytes)) throw new Error("workspace_plan_limit");
  if (projectedBytes > limits.maxTotalBytes && (!previous || bytes > previous.bytes)) throw new Error("workspace_plan_limit");
  const now = Date.now();
  const record: WorkspaceRecord = {
    id, kind, name: safeText(name.trim() || "Untitled", 140),
    preview: previewFor(kind, payloadJson),
    createdAt: previous?.createdAt ?? now, updatedAt: now, bytes, payloadJson,
  };
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(record);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error ?? new Error("workspace_storage_failed"));
    });
    db.close();
  } catch (error) {
    if (error instanceof Error && ["workspace_item_too_large", "workspace_plan_limit"].includes(error.message)) throw error;
    const records = readFallback().filter((item) => item.id !== id);
    records.unshift(record);
    writeFallback(records);
  }
  // The selected device folder is the user's durable file location. Keep the
  // browser database as a bounded local index/cache and mirror each draft there.
  try { await writeWorkspaceDraftSnapshot(record as DraftSnapshotRecord); } catch { /* Browser-local copy remains available. */ }
  return { id, kind, name: record.name, preview: record.preview, createdAt: record.createdAt, updatedAt: record.updatedAt, bytes };
}

export async function listWorkspaceItems(): Promise<WorkspaceSummary[]> {
  let records: WorkspaceRecord[] = [];
  try {
    const db = await openDb();
    records = await new Promise<WorkspaceRecord[]>((resolve, reject) => {
      const request = db.transaction(STORE, "readonly").objectStore(STORE).getAll();
      request.onsuccess = () => resolve((request.result as unknown[]).filter(isRecord));
      request.onerror = () => reject(request.error);
    }).finally(() => db.close());
  } catch { /* A localStorage fallback may still contain successfully saved drafts. */ }
  return mergeRecords(records).map(({ id, kind, name, preview, createdAt, updatedAt, bytes }) => ({ id, kind, name, preview, createdAt, updatedAt, bytes }));
}

export async function loadWorkspaceItem<T = unknown>(id: string): Promise<(WorkspaceSummary & { payload: T }) | null> {
  const record = await getRecordRaw(id);
  if (!record) return null;
  try {
    return { id: record.id, kind: record.kind, name: record.name, preview: record.preview, createdAt: record.createdAt, updatedAt: record.updatedAt, bytes: record.bytes, payload: JSON.parse(record.payloadJson) as T };
  } catch { throw new Error("workspace_record_corrupt"); }
}

export async function clearWorkspaceItems(): Promise<number> {
  const records = await allRecords();
  let db: IDBDatabase | null = null;
  try { db = await openDb(); } catch { writeFallback([]); return records.length; }
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db!.transaction(STORE, "readwrite");
      tx.objectStore(STORE).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error ?? new Error("workspace_storage_failed"));
    });
    try { writeFallback([]); } catch { /* IndexedDB is cleared; fallback cleanup is best effort. */ }
    return records.length;
  } finally { db.close(); }
}

export async function deleteWorkspaceItem(id: string): Promise<void> {
  await deleteWorkspaceDraftSnapshot(id);
  let db: IDBDatabase | null = null;
  try { db = await openDb(); } catch { writeFallback(readFallback().filter((item) => item.id !== id)); return; }
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db!.transaction(STORE, "readwrite");
      tx.objectStore(STORE).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error ?? new Error("workspace_storage_failed"));
    });
    try { writeFallback(readFallback().filter((item) => item.id !== id)); } catch { /* IndexedDB deletion already succeeded. */ }
  } finally { db.close(); }
}

export async function syncWorkspaceDraftsToConnectedFolder(): Promise<{ saved: number; skipped: number }> {
  const records = await allRecords();
  let saved = 0;
  let skipped = 0;
  for (const record of records) {
    let result: FolderWriteResult = "failed";
    try { result = await writeWorkspaceDraftSnapshot(record as DraftSnapshotRecord); } catch { result = "failed"; }
    if (result === "saved") saved += 1; else skipped += 1;
  }
  return { saved, skipped };
}

export async function importWorkspaceDraftsFromConnectedFolder(): Promise<number> {
  const files = await readWorkspaceDraftFilesFromFolder();
  let imported = 0;
  for (const file of files) {
    try {
      const parsed = JSON.parse(await file.text()) as { format?: unknown; version?: unknown; record?: unknown };
      if (parsed.format !== "pdf-ai-tools-draft" || parsed.version !== 1 || !isRecord(parsed.record)) continue;
      const record = parsed.record;
      const current = await getRecordRaw(record.id);
      // When the folder and browser both have a draft, keep the newer timestamp.
      if (current && current.updatedAt > record.updatedAt) continue;
      const payload = JSON.parse(record.payloadJson);
      await saveWorkspaceItem(record.kind, record.name, payload, record.id);
      imported += 1;
    } catch { /* Ignore unrelated, corrupt, or oversized folder files. */ }
  }
  return imported;
}

async function allRecords(): Promise<WorkspaceRecord[]> {
  let records: WorkspaceRecord[] = [];
  try {
    const db = await openDb();
    records = await new Promise<WorkspaceRecord[]>((resolve, reject) => {
      const request = db.transaction(STORE, "readonly").objectStore(STORE).getAll();
      request.onsuccess = () => resolve((request.result as unknown[]).filter(isRecord));
      request.onerror = () => reject(request.error);
    }).finally(() => db.close());
  } catch { /* Include fallback records below. */ }
  return mergeRecords(records);
}

export async function exportWorkspaceBackup(): Promise<Blob> {
  const records = (await allRecords()).sort((a, b) => b.updatedAt - a.updatedAt);
  const json = JSON.stringify({ format: "pdf-ai-tools-workspace", version: 1, exportedAt: Date.now(), items: records });
  if (new TextEncoder().encode(json).byteLength > getWorkspaceLimits().maxBackupBytes) throw new Error("workspace_backup_too_large");
  return new Blob([json], { type: "application/json;charset=utf-8" });
}

export async function importWorkspaceBackup(file: File): Promise<number> {
  const limits = getWorkspaceLimits();
  if (file.size > limits.maxBackupBytes) throw new Error("workspace_backup_too_large");
  let parsed: unknown;
  try { parsed = JSON.parse(await file.text()); } catch { throw new Error("workspace_backup_invalid"); }
  if (!parsed || typeof parsed !== "object") throw new Error("workspace_backup_invalid");
  const backup = parsed as { format?: unknown; version?: unknown; items?: unknown };
  if (backup.format !== "pdf-ai-tools-workspace" || backup.version !== 1 || !Array.isArray(backup.items) || backup.items.length > 250) throw new Error("workspace_backup_invalid");
  let count = 0;
  for (const item of backup.items) {
    if (!isRecord(item) || new TextEncoder().encode(item.payloadJson).byteLength > limits.maxRecordBytes) continue;
    try {
      const payload = JSON.parse(item.payloadJson);
      await saveWorkspaceItem(item.kind, item.name, payload, item.id);
      count += 1;
    } catch (error) {
      // A lower plan may restore only as many drafts as its local quota permits.
      if (error instanceof Error && error.message === "workspace_plan_limit") break;
      /* Skip malformed or oversized records; do not abort the valid remainder. */
    }
  }
  return count;
}
