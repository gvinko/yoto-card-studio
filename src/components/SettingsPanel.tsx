import { useState } from "react";
import {
  getClientId,
  redirectUri,
  setClientId,
  signOut,
} from "../lib/yoto/auth";
export function SettingsPanel() {
  const [client, setClient] = useState(getClientId());
  const [status, setStatus] = useState("");
  return (
    <section className="card space-y-4">
      <h2 className="text-xl font-semibold">Yoto public browser app</h2>
      <p className="text-slate-300">
        Create a free public browser app at{" "}
        <a
          className="underline text-amber-300"
          href="https://dashboard.yoto.dev"
          target="_blank"
          rel="noreferrer"
        >
          dashboard.yoto.dev
        </a>
        . Register the callback below. A public client ID is safe to store here;
        never enter a client secret.
      </p>
      <p className="break-all rounded-lg bg-slate-950 p-3 text-sm">
        {redirectUri()}
      </p>
      <button
        className="btn"
        onClick={() =>
          navigator.clipboard
            ?.writeText(redirectUri())
            .then(() => setStatus("Callback copied."))
            .catch(() => setStatus("Copy the URL above manually."))
        }
      >
        Copy callback URL
      </button>
      <label className="block">
        Public client ID
        <input
          className="field mt-2 w-full"
          value={client}
          onChange={(e) => setClient(e.target.value)}
        />
      </label>
      <button
        className="btn-primary"
        onClick={() => {
          if (client !== getClientId()) signOut();
          setClientId(client);
          setStatus("Client ID saved.");
        }}
      >
        Save settings
      </button>
      <button
        className="btn ml-3"
        onClick={() => {
          signOut();
          setStatus("Yoto signed out on this browser.");
        }}
      >
        Sign out of Yoto
      </button>
      <p className="text-sm text-slate-300">
        Yoto uses its official browser PKCE flow. Personal OAuth tokens are held
        in this browser at runtime and excluded from backups. Other service
        credentials belong only in the optional gateway’s server environment.
        The parent PIN is a local navigation lock; use operating-system controls
        for a shared device.
      </p>
      <p role="status" className="text-amber-200">
        {status}
      </p>
    </section>
  );
}
