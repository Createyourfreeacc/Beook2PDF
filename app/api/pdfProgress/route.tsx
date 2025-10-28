import { NextRequest } from 'next/server';
import { getProgress } from '@/lib/progressStore';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const jobId = searchParams.get('jobId');
  if (!jobId) return new Response("Missing jobId", { status: 400 });

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();

      const interval = setInterval(() => {
        const current = getProgress(jobId);
        controller.enqueue(encoder.encode(`data: ${current}\n\n`));
        if (current >= 100) {
          clearInterval(interval);
        }
      }, 800);
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

