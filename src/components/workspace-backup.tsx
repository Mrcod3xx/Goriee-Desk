"use client";
import { useState } from "react";
import { captureWorkspace, parseWorkspaceBackup, restoreWorkspace, type WorkspaceSnapshot } from "@/lib/workspace-backup";

function download(snapshot: WorkspaceSnapshot, prefix = "goriee-backup") {
  const url = URL.createObjectURL(new Blob([JSON.stringify(snapshot, null, 2)], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `${prefix}-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function WorkspaceBackup() {
  const [pending, setPending] = useState<WorkspaceSnapshot | null>(null);
  const [message, setMessage] = useState("");
  return <section className="panel workspace-backup" aria-labelledby="backup-heading">
    <h2 id="backup-heading">Back up your workspace</h2>
    <p>Export your journal, watchlist, paper fills, review notes, brackets, alerts, playbooks, risk settings, draft prompts, auto rule-runner configuration, execution audit logs and AI copilot sessions. Provider credentials are excluded. Data belongs to this browser and address; localhost and 127.0.0.1 have separate histories.</p>
    <div className="backup-actions"><button className="button button-secondary" onClick={() => { try { download(captureWorkspace(localStorage)); setMessage("Backup downloaded."); } catch { setMessage("Could not read browser storage for export."); } }}>Download backup</button>
    <label>Choose backup to restore<input type="file" accept=".json,application/json" onChange={async (event) => {
      const file = event.target.files?.[0];
      setPending(null); setMessage(""); event.target.value = "";
      if (!file) return;
      try {
        if (file.size > 4_000_000) throw new Error("Backup is too large (4 MB maximum).");
        setPending(parseWorkspaceBackup(await file.text()));
      } catch (error) { setMessage(error instanceof Error ? error.message : "Invalid backup."); }
    }} /></label></div>
    {pending ? <div className="backup-preview"><h3>Restore preview</h3><p>Saved {new Date(pending.exportedAt).toLocaleString()}. {Object.entries(pending.data).filter(([, value]) => Array.isArray(value)).map(([key, value]) => `${key.replace("goriee.", "").replace(".v1", "")}: ${(value as unknown[]).length}`).join(" · ")}</p><p>Restore replaces the saved workspace at this address. A copy of your current workspace will download first. The page then reloads.</p><button className="button button-primary" onClick={() => {
      try {
        try { window.localStorage.setItem("goriee.auto-rule-runner.v1", "false"); } catch {}
        download(captureWorkspace(localStorage), "goriee-before-restore");
        restoreWorkspace(localStorage, pending);
        window.location.reload();
      } catch (err) {
        setMessage(err instanceof Error ? err.message : "Restore failed. Verify available browser storage and your backup file.");
      }
    }}>Replace workspace with this backup</button><button className="button button-secondary" onClick={() => setPending(null)}>Cancel restore</button></div> : null}
    {message ? <p role="status">{message}</p> : null}
  </section>;
}
