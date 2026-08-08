'use client';

import { createContext, useContext, useState, useCallback, useRef } from 'react';

export interface ImageGenResult {
  id: string;
  text?: string;
  images: Array<{ data: string; mimeType: string; localPath?: string }>;
}

export interface ImageGenState {
  enabled: boolean;
  generating: boolean;
}

export interface ImageGenContextValue {
  state: ImageGenState;
  setEnabled: (v: boolean) => void;
  generate: (prompt: string, aspectRatio: string, imageSize: string, referenceImages?: File[]) => Promise<ImageGenResult | null>;
  lastResult: ImageGenResult | null;
}

export const ImageGenContext = createContext<ImageGenContextValue | null>(null);

export function useImageGen(): ImageGenContextValue {
  const ctx = useContext(ImageGenContext);
  if (!ctx) {
    throw new Error('useImageGen must be used within an ImageGenProvider');
  }
  return ctx;
}

export function useImageGenState(): ImageGenContextValue {
  const [enabled, setEnabled] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [lastResult, setLastResult] = useState<ImageGenResult | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const generate = useCallback(async (prompt: string, aspectRatio: string, imageSize: string, referenceImages?: File[]): Promise<ImageGenResult | null> => {
    if (abortRef.current) {
      abortRef.current.abort();
    }
    const controller = new AbortController();
    abortRef.current = controller;

    setGenerating(true);
    try {
      const body: Record<string, unknown> = {
        prompt,
        aspectRatio,
        imageSize,
      };

      if (referenceImages && referenceImages.length > 0) {
        const refImagesData: Array<{ data: string; mimeType: string; name: string }> = [];
        for (const file of referenceImages) {
          const buffer = await file.arrayBuffer();
          const base64 = btoa(
            new Uint8Array(buffer).reduce((data, byte) => data + String.fromCharCode(byte), '')
          );
          refImagesData.push({
            data: base64,
            mimeType: file.type,
            name: file.name,
          });
        }
        body.referenceImages = refImagesData;
      }

      const res = await fetch('/api/media/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Generation failed' }));
        throw new Error(err.error || 'Generation failed');
      }

      const data = await res.json();
      const result: ImageGenResult = {
        id: data.id,
        text: data.text,
        images: data.images || [],
      };

      setLastResult(result);
      return result;
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        return null;
      }
      throw err;
    } finally {
      setGenerating(false);
      abortRef.current = null;
    }
  }, []);

  return {
    state: { enabled, generating },
    setEnabled,
    generate,
    lastResult,
  };
}
