import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient, currentUserId } from "@/lib/supabase/server";
import LoginForm from "./LoginForm";

export const metadata: Metadata = { title: "Sign in · FPL Raptor" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const params = await searchParams;
  const nextParam = typeof params.next === "string" ? params.next : "/me";
  const next = nextParam.startsWith("/") && !nextParam.startsWith("//") ? nextParam : "/me";

  const supabase = await createClient();
  if (await currentUserId(supabase)) redirect(next);

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col gap-6 px-4 py-10">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Sign in</h1>
        <p className="mt-1 text-zinc-500 dark:text-zinc-400">
          New here? Enter your email and pick a password, then tap Create an account.
        </p>
      </div>
      <LoginForm next={next} />
    </main>
  );
}
