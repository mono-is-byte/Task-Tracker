import { requireMember } from "@/lib/api";
import { currentSeq, subscribe } from "@/lib/events";

// Server-sent events for realtime updates, with polling fallback on the client.
// GET /api/projects/:id/events  →  text/event-stream of {seq,type,payload}
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireMember(req, id, "view_project");
  if ("response" in auth) return auth.response;

  const stream = new ReadableStream({
    start(controller) {
      const enc = new TextEncoder();
      const send = (data: string) => {
        try {
          controller.enqueue(enc.encode(data));
        } catch { /* closed */ }
      };
      send(`: connected\n\n`);
      send(`data: ${JSON.stringify({ seq: currentSeq(), type: "hello" })}\n\n`);
      const off = subscribe(id, (e) => {
        send(`data: ${JSON.stringify({ seq: e.seq, type: e.type, payload: e.payload })}\n\n`);
      });
      const beat = setInterval(() => send(`: ping\n\n`), 25000);
      const close = () => {
        clearInterval(beat);
        off();
        try { controller.close(); } catch { /* already closed */ }
      };
      // best-effort cleanup if client disconnects
      req.signal.addEventListener("abort", close, { once: true });
      setTimeout(close, 5 * 60 * 1000); // recycle connection every 5 min
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
