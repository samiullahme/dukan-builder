import { ForgotPasswordForm } from "@/components/forms";
import { getUser } from "@/lib/auth";
import { redirect } from "next/navigation";

export default async function ForgotPasswordPage() {
  if (await getUser()) redirect("/dashboard");
  return <ForgotPasswordForm />;
}
