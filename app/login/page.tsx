import { LoginForm } from "@/components/forms";
import { getUser } from "@/lib/auth";
import { redirect } from "next/navigation";

export default async function LoginPage() {
  if (await getUser()) redirect("/dashboard");
  return <LoginForm />;
}
