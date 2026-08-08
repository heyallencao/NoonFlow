'use client';

import { useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';

export default function TerminalSessionPage() {
  const params = useParams<{ id?: string | string[] }>();
  const rawId = params?.id;
  const id = Array.isArray(rawId) ? rawId[0] : rawId;
  const router = useRouter();

  useEffect(() => {
    if (!id) return;
    // Terminal is now embedded as a panel in the chat view.
    // Redirect old terminal URLs to the chat page.
    router.replace(`/chat/${id}`);
  }, [id, router]);

  return (
    <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
      Redirecting...
    </div>
  );
}
