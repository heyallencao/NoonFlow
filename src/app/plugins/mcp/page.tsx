"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function McpRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/mcp");
  }, [router]);
  return null;
}
