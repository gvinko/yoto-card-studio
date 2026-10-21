// Browser PKCE flow per https://yoto.dev/authentication/browser-auth
// Login runs in a popup so the loaded audiobook (in-memory File objects) survives sign-in.

const AUTH = 'https://login.yotoplay.com';
export const API = 'https://api.yotoplay.com';
const SCOPES = 'user:content:manage user:icons:manage offline_access';
const K = { client: 'yoto.clientId', tokens: 'yoto.tokens', verifier: 'yoto.pkce' } as const;

interface Tokens {
  access_token: string;
  refresh_token?: string;
  exp: number; // ms epoch
}

export const getClientId = () => localStorage.getItem(K.client) ?? '';
export const setClientId = (v: string) => localStorage.setItem(K.client, v.trim());
export const redirectUri = () => location.origin + location.pathname;

function b64url(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  for (const b of arr) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function jwtExp(token: string): number {
  try {
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return payload.exp * 1000;
  } catch {
    return Date.now() + 30 * 60e3;
  }
}

function loadTokens(): Tokens | null {
  try {
    return JSON.parse(localStorage.getItem(K.tokens) ?? 'null');
  } catch {
    return null;
  }
}

function saveTokens(t: { access_token: string; refresh_token?: string }) {
  const prev = loadTokens();
  const next: Tokens = {
    access_token: t.access_token,
    refresh_token: t.refresh_token ?? prev?.refresh_token, // refresh tokens rotate; keep the newest
    exp: jwtExp(t.access_token),
  };
  localStorage.setItem(K.tokens, JSON.stringify(next));
}

export const isSignedIn = () => !!loadTokens()?.refresh_token || !!loadTokens()?.access_token;
export const signOut = () => localStorage.removeItem(K.tokens);

async function tokenRequest(body: Record<string, string>) {
  const r = await fetch(`${AUTH}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: getClientId(), ...body }),
  });
  if (!r.ok) throw new Error(`Yoto sign-in failed (${r.status}): ${await r.text()}`);
  saveTokens(await r.json());
}

/** Opens Yoto login. Resolves once the popup has stored tokens. */
export async function signIn(): Promise<void> {
  if (!getClientId()) throw new Error('Add your Yoto client ID in Settings first.');
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  localStorage.setItem(K.verifier, verifier); // localStorage: shared with the popup tab
  const url = `${AUTH}/authorize?${new URLSearchParams({
    audience: API,
    scope: SCOPES,
    response_type: 'code',
    client_id: getClientId(),
    code_challenge: challenge,
    code_challenge_method: 'S256',
    redirect_uri: redirectUri(),
  })}`;
  const popup = window.open(url, 'yoto-login', 'width=480,height=720');
  if (!popup) {
    location.href = url; // popup blocked: full redirect (unsaved work is lost)
    return;
  }
  const before = loadTokens()?.access_token;
  await new Promise<void>((resolve, reject) => {
    const timer = setInterval(() => {
      const now = loadTokens()?.access_token;
      if (now && now !== before) {
        clearInterval(timer);
        resolve();
      } else if (popup.closed) {
        clearInterval(timer);
        isSignedIn() ? resolve() : reject(new Error('Sign-in window closed'));
      }
    }, 500);
  });
}

/** Call once on boot. Returns true when this tab was the OAuth callback (and closes it if it was a popup). */
export async function completeSignInIfCallback(): Promise<boolean> {
  const q = new URLSearchParams(location.search);
  const code = q.get('code');
  if (!code) return false;
  history.replaceState(null, '', redirectUri());
  const verifier = localStorage.getItem(K.verifier);
  localStorage.removeItem(K.verifier);
  if (!verifier) return false;
  await tokenRequest({ grant_type: 'authorization_code', code_verifier: verifier, code, redirect_uri: redirectUri() });
  if (window.opener) window.close();
  return true;
}

let refreshing: Promise<void> | null = null;

export async function getAccessToken(): Promise<string> {
  const t = loadTokens();
  if (!t) throw new Error('Not signed in to Yoto');
  if (t.exp - Date.now() > 60e3) return t.access_token;
  if (!t.refresh_token) throw new Error('Yoto session expired — sign in again');
  refreshing ??= tokenRequest({ grant_type: 'refresh_token', refresh_token: t.refresh_token }).finally(() => {
    refreshing = null;
  });
  await refreshing;
  return loadTokens()!.access_token;
}
