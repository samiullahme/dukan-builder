"use server";

import { redirect } from "next/navigation";
import { supabaseServer } from "./auth";

export async function logout() {
  const sb = await supabaseServer();
  await sb.auth.signOut();
  redirect("/login");
}
