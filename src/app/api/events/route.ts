import { requireUser } from "@/lib/api";
import { currentSeq, subscribeGlobal } from "@/lib/events";

/**
 * Step 5: server-wide SSE stream. Published events are rare (a project moving
 * between the active and Completed lists), so the sidebar subscribes here to
 * refresh itself without a full page reload.
 * GET /api/events → text/event-stream of {seq,type,payload}
 */
export async function GET(req: Request) {
  const auth = await requireUser(req);
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
      const off = subscribeGlobal((e) => {
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
