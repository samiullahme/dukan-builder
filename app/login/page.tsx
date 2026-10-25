import { LoginForm } from "@/components/forms";
import { getUser } from "@/lib/auth";
import { redirect } from "next/navigation";

export default async function LoginPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = (await searchParams) ?? {};
  const code = typeof sp.code === "string" ? sp.code : "";
  const tokenHash = typeof sp.token_hash === "string" ? sp.token_hash : "";
  const type = typeof sp.type === "string" ? sp.type : "";
  if (code || tokenHash) {
    const qs = new URLSearchParams();
    if (code) qs.set("code", code);
    if (tokenHash) qs.set("token_hash", tokenHash);
    if (type) qs.set("type", type);
    redirect(`/reset-password?${qs.toString()}`);
  }
  if (await getUser()) redirect("/dashboard");
  return <LoginForm />;
}
