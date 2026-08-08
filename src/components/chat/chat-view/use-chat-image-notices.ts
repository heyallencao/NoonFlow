import { useCallback, useEffect, useRef } from 'react';
import { setLastGeneratedImages } from '@/lib/image-ref-store';
import { subscribeImageGenerationCompleted } from '@/lib/events/app-event-bus';

interface UseChatImageNoticesParams {
  sessionId: string;
}

interface UseChatImageNoticesResult {
  consumePendingImageNotices: () => string[] | undefined;
}

export function useChatImageNotices(
  params: UseChatImageNoticesParams,
): UseChatImageNoticesResult {
  const { sessionId } = params;
  const pendingImageNoticesRef = useRef<string[]>([]);

  const consumePendingImageNotices = useCallback(() => {
    if (pendingImageNoticesRef.current.length === 0) {
      return undefined;
    }
    const notices = [...pendingImageNoticesRef.current];
    pendingImageNoticesRef.current = [];
    return notices;
  }, []);

  useEffect(() => {
    const unsubscribe = subscribeImageGenerationCompleted((detail) => {
      if (!detail) return;
      const paths = (detail.images || [])
        .map((img: { localPath?: string }) => img.localPath)
        .filter((localPath): localPath is string => Boolean(localPath));
      const pathInfo = paths.length > 0 ? `\nGenerated image file paths:\n${paths.map((p: string) => `- ${p}`).join('\n')}` : '';
      const notice = `[Image generation completed]\n- Prompt: "${detail.prompt}"\n- Aspect ratio: ${detail.aspectRatio}\n- Resolution: ${detail.resolution}${pathInfo}`;

      if (paths.length > 0) {
        setLastGeneratedImages(paths);
      }

      pendingImageNoticesRef.current.push(notice);

      const dbNotice = `[__IMAGE_GEN_NOTICE__ prompt: "${detail.prompt}", aspect ratio: ${detail.aspectRatio}, resolution: ${detail.resolution}${paths.length > 0 ? `, file path: ${paths.join(', ')}` : ''}]`;
      void fetch('/api/chat/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: sessionId, role: 'user', content: dbNotice }),
      }).catch(() => {});
    });
    return unsubscribe;
  }, [sessionId]);

  return {
    consumePendingImageNotices,
  };
}
