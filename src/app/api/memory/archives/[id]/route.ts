import { NextRequest } from "next/server";
import { deleteMemoryArchiveById, getMemoryArchiveById } from "@/lib/workspace-memory";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const archive = await getMemoryArchiveById(id);
    if (!archive) {
      return Response.json({ error: "Archive not found" }, { status: 404 });
    }
    return Response.json({ archive });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to fetch archive";
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const deleted = await deleteMemoryArchiveById(id);
    if (!deleted) {
      return Response.json({ error: "Archive not found" }, { status: 404 });
    }
    return Response.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to delete archive";
    return Response.json({ error: message }, { status: 500 });
  }
}
