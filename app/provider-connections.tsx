'use client';

import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';

export type ConnectionSetup = {
  gateway: string;
  sandbox: string;
  message: string;
};

function AccessForm({ initialCode, onSave }: { initialCode: string; onSave: (code: string) => void }) {
  const [code, setCode] = useState(initialCode);
  return <form className="access-form" onSubmit={(event) => { event.preventDefault(); onSave(code.trim()); }}>
    <input type="password" aria-label="Workspace access code" autoComplete="off" value={code} onChange={(event) => setCode(event.target.value)} />
    <button type="submit" className="share-button">Save code</button>
  </form>;
}

export function ProviderConnections({ open, onClose, setup, onRefresh, loading, accessRequired = false, accessCode = '', onAccessCodeChange }: {
  open: boolean;
  onClose: () => void;
  setup: ConnectionSetup | null;
  onRefresh: () => void;
  loading: boolean;
  accessRequired?: boolean;
  accessCode?: string;
  onAccessCodeChange?: (code: string) => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (open) dialogRef.current?.showModal();
    else dialogRef.current?.close();
  }, [open]);

  return <dialog ref={dialogRef} className="provider-dialog" onClose={onClose} aria-labelledby="provider-title">
    <header><h2 id="provider-title">Provider connections</h2><button autoFocus onClick={onClose} aria-label="Close provider connections"><X size={18} /></button></header>
    <p aria-live="polite">{setup?.message ?? 'Connection status could not be loaded. Try refreshing.'}</p>
    {accessRequired && <section><h3>Workspace access <span>{accessCode ? 'Code saved' : 'Code required'}</span></h3>
      <p>This deployment requires an access code before agents can run. It is the server’s <code>COLLABORAGENT_ACCESS_TOKEN</code>, not a provider credential, and is kept only in this browser.</p>
      <AccessForm key={accessCode} initialCode={accessCode} onSave={(code) => onAccessCodeChange?.(code)} />
    </section>}
    <section><h3>Model team <span>{setup?.gateway === 'configured' ? 'Configured' : 'Needs setup'}</span></h3>
      <p>Coding, design, and research use the server’s AI Gateway connection. This is separate from a ChatGPT or Claude subscription.</p>
      <details><summary>Server setup</summary><p>Set <code>AI_GATEWAY_API_KEY</code> in your deployment’s environment settings, then redeploy. Local development reads <code>.env.local</code> after a restart.</p></details>
    </section>
    <section><h3>Coding agents <span>{setup?.sandbox === 'configured' ? 'Sandbox configured' : setup?.sandbox === 'expired-or-invalid' ? 'Credential expired or invalid' : 'Needs sandbox'}</span></h3>
      <p>Claude Code and Codex share a Vercel Sandbox. The sandbox needs its own server credentials in addition to the model connection.</p>
      <details><summary>Sandbox setup</summary><p>Use Vercel’s deployment OIDC credentials. For local development, link the correct project and refresh <code>VERCEL_OIDC_TOKEN</code> using <code>vercel env pull .env.local</code>, then restart.</p><p>Alternatively, configure <code>VERCEL_TOKEN</code>, <code>VERCEL_TEAM_ID</code>, and <code>VERCEL_PROJECT_ID</code> together on the server. Sandbox usage is billed separately.</p></details>
    </section>
    <section><h3>Can I use my subscriptions?</h3>
      <p><strong>Codex:</strong> ChatGPT sign-in works in official Codex clients. This app’s installed sandbox adapter supports API keys and AI Gateway, not ChatGPT subscription login.</p>
      <p><strong>Claude Code:</strong> Claude subscription login is not available here. Anthropic requires approval for third-party products to offer Claude.ai sign-in; use API or gateway access for this hosted app.</p>
      <p><a href="https://learn.chatgpt.com/docs/auth" target="_blank" rel="noreferrer">Codex authentication</a> · <a href="https://code.claude.com/docs/en/legal-and-compliance" target="_blank" rel="noreferrer">Claude authentication rules</a></p>
    </section>
    <button className="share-button" onClick={onRefresh} disabled={loading}>{loading ? 'Checking…' : 'Refresh connection status'}</button>
  </dialog>;
}
