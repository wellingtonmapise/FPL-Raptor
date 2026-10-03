import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";

// Runs before every page request to refresh the Supabase sign-in session.
export async function proxy(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  matcher: [
    // Everything except static files and images.
    "/((?!_next/static|_next/image|favicon.ico|sw.js|.*\\.(?:svg|png|jpg|jpeg|gif|webp|webmanifest)$).*)",
  ],
};
