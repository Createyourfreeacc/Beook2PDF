import { NextRequest } from 'next/server';
import { getProgress } from '@/lib/progressStore';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const jobId = searchParams.get('jobId');
  if (!jobId) return new Response("Missing jobId", { status: 400 });

  let intervalId: NodeJS.Timeout;

  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();

      intervalId = setInterval(() => {
        const current = getProgress(jobId);
        try {
          controller.enqueue(encoder.encode(`data: ${current}\n\n`));
          if (current >= 100) {
            clearInterval(intervalId);
            controller.close();
          }
        } catch {
          // Controller is closed (client disconnected), stop polling
          clearInterval(intervalId);
        }
      }, 800);
    },
    cancel() {
      // Called when client disconnects
      clearInterval(intervalId);
    }
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}

