import { supabase } from '../supabaseClient';

const BASE = import.meta.env.VITE_BACKEND_URL ?? 'http://localhost:3001';

async function getToken() {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token ?? null;
}

export async function apiCall(method, path, body) {
  const token = await getToken();
  const headers = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;

  let fetchBody;
  if (body instanceof FormData) {
    fetchBody = body;
  } else if (body != null) {
    headers['Content-Type'] = 'application/json';
    fetchBody = JSON.stringify(body);
  }

  const res = await fetch(`${BASE}${path}`, { method, headers, body: fetchBody });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error ?? `HTTP ${res.status}`);
  }
  return res.json();
}
