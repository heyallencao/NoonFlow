import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main className="flex h-full min-h-[70vh] w-full items-center justify-center px-6">
      <div className="w-full max-w-xl rounded-lg bg-bg-tertiary p-8 text-center">
        <p className="mb-2 text-xs tracking-[0.25em] text-foreground/50">404</p>
        <h1 className="mb-3 text-3xl font-semibold text-foreground">Page not found</h1>
        <p className="mb-6 text-sm text-foreground/75">
          This route does not exist in the current build. Use the sidebar to return to an available module.
        </p>
        <Button asChild>
          <Link href="/">Back to NoonFlow</Link>
        </Button>
      </div>
    </main>
  );
}
