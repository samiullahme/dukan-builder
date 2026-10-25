import { SignupForm } from "@/components/forms";
import { getUser } from "@/lib/auth";
import { redirect } from "next/navigation";

export default async function SignupPage() {
  if (await getUser()) redirect("/dashboard");
  return <SignupForm />;
}
