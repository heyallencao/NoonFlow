import { listMemoryArchives } from "@/lib/workspace-memory";

export async function GET() {
  try {
    const archives = await listMemoryArchives();
    return Response.json({ archives });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to fetch archives";
    return Response.json({ error: message }, { status: 500 });
  }
}
