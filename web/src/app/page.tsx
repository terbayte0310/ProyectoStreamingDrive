import { redirect } from "next/navigation";

import { getCurrentAccess } from "@/lib/auth/access";

export default async function Home() {
  const access = await getCurrentAccess();
  if (!access) redirect("/signin");
  redirect(access.profile?.is_authorized ? "/catalog" : "/dashboard");
}
