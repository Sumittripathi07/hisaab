import { redirect } from "next/navigation";
import { getSessionUser } from "@/server/session";

// No landing page until Phase 6: straight into the app, or to sign-in.
export default async function Home() {
  redirect((await getSessionUser()) ? "/dashboard" : "/sign-in");
}
