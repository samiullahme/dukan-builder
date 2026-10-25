import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { notFound, redirect } from "next/navigation";
import { get } from "./db";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SUPABASE_SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;

export type User = {
  id: string;
  email: string;
  created_at: string;
  is_admin: number;
  status: string;
};

export async function supabaseServer(): Promise<SupabaseClient> {
  const store = await cookies();
  return createServerClient(SUPABASE_URL!, SUPABASE_ANON!, {
    cookies: {
      getAll() {
        return store.getAll();
      },
      setAll(list) {
        try {
          for (const { name, value, options } of list) store.set(name, value, options);
        } catch {
          // called from a server component — the middleware handles writes
        }
      },
    },
  });
}

export function supabaseService(): SupabaseClient {
  return createClient(SUPABASE_URL!, SUPABASE_SERVICE!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function getUser(): Promise<User | null> {
  const sb = await supabaseServer();
  let user: { id: string; email?: string | null } | null = null;
  try {
    ({ data: { user } } = await sb.auth.getUser());
  } catch {
    // an invalid/expired session can make getUser() throw instead of returning
    // an error — treat that the same as "not signed in"
    return null;
  }
  if (!user) return null;
  const profile = await get<{ is_admin: number; status: string; created_at: string }>(
    "SELECT is_admin, status, created_at FROM profiles WHERE id = ?",
    user.id
  );
  if (!profile || profile.status === "suspended") return null;
  return {
    id: user.id,
    email: user.email ?? "",
    created_at: profile.created_at,
    is_admin: profile.is_admin,
    status: profile.status,
  };
}

export async function requireUser(): Promise<User> {
  const u = await getUser();
  if (!u) redirect("/login");
  return u;
}

export async function requireAdmin(): Promise<User> {
  const u = await getUser();
  if (!u) redirect("/login");
  if (u.is_admin !== 1) notFound();
  return u;
}
