"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, Suspense } from "react";

function ExtensionsRedirect() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tab = searchParams.get("tab");

  useEffect(() => {
    if (tab === "hooks") {
      router.replace("/hooks");
    } else if (tab === "agents") {
      router.replace("/agents");
    } else if (tab === "mcp") {
      router.replace("/mcp");
    } else {
      router.replace("/skills");
    }
  }, [router, tab]);

  return null;
}

export default function ExtensionsPage() {
  return (
    <Suspense fallback={null}>
      <ExtensionsRedirect />
    </Suspense>
  );
}
