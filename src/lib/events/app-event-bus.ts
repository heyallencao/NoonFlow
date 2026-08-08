import type { SessionType } from '@/types';

interface ImageGenerationCompletedDetail {
  prompt: string;
  aspectRatio: string;
  resolution: string;
  images?: Array<{ localPath?: string }>;
}

interface SessionTabClosedDetail {
  sessionId?: string;
  sessionType?: SessionType;
}

interface AppEventMap {
  'attach-file-to-chat': { path: string };
  'insert-path-to-chat': { path: string };
  'open-file-preview': { path: string };
  'image-gen-completed': ImageGenerationCompletedDetail;
  'provider-changed': undefined;
  'refresh-file-tree': undefined;
  'session-tab-closed': SessionTabClosedDetail;
  'tasks-updated': undefined;
}

type AppEventName = keyof AppEventMap;
type AppEventListener<T extends AppEventName> = (detail: AppEventMap[T]) => void;

const GLOBAL_APP_EVENT_BUS_KEY = '__noonflowAppEventBus__' as const;

class AppEventBus {
  private listeners = new Map<AppEventName, Set<(detail: unknown) => void>>();

  emit<T extends AppEventName>(eventName: T, detail: AppEventMap[T]): void {
    this.listeners.get(eventName)?.forEach((listener) => listener(detail));
  }

  on<T extends AppEventName>(eventName: T, listener: AppEventListener<T>): () => void {
    const listeners = this.listeners.get(eventName) ?? new Set<(detail: unknown) => void>();
    listeners.add(listener as (detail: unknown) => void);
    this.listeners.set(eventName, listeners);

    return () => {
      const currentListeners = this.listeners.get(eventName);
      if (!currentListeners) {
        return;
      }

      currentListeners.delete(listener as (detail: unknown) => void);
      if (currentListeners.size === 0) {
        this.listeners.delete(eventName);
      }
    };
  }
}

function getAppEventBus(): AppEventBus {
  const globalObject = globalThis as Record<string, unknown>;
  if (!globalObject[GLOBAL_APP_EVENT_BUS_KEY]) {
    globalObject[GLOBAL_APP_EVENT_BUS_KEY] = new AppEventBus();
  }
  return globalObject[GLOBAL_APP_EVENT_BUS_KEY] as AppEventBus;
}

const appEventBus = getAppEventBus();

export function publishAttachFileToChat(detail: AppEventMap['attach-file-to-chat']) {
  appEventBus.emit('attach-file-to-chat', detail);
}

export function subscribeAttachFileToChat(listener: AppEventListener<'attach-file-to-chat'>) {
  return appEventBus.on('attach-file-to-chat', listener);
}

export function publishInsertPathToChat(detail: AppEventMap['insert-path-to-chat']) {
  appEventBus.emit('insert-path-to-chat', detail);
}

export function subscribeInsertPathToChat(listener: AppEventListener<'insert-path-to-chat'>) {
  return appEventBus.on('insert-path-to-chat', listener);
}

export function publishOpenFilePreview(detail: AppEventMap['open-file-preview']) {
  appEventBus.emit('open-file-preview', detail);
}

export function subscribeOpenFilePreview(listener: AppEventListener<'open-file-preview'>) {
  return appEventBus.on('open-file-preview', listener);
}

export function publishImageGenerationCompleted(detail: ImageGenerationCompletedDetail) {
  appEventBus.emit('image-gen-completed', detail);
}

export function subscribeImageGenerationCompleted(
  listener: AppEventListener<'image-gen-completed'>,
) {
  return appEventBus.on('image-gen-completed', listener);
}

export function publishProviderChanged() {
  appEventBus.emit('provider-changed', undefined);
}

export function subscribeProviderChanged(listener: () => void) {
  return appEventBus.on('provider-changed', listener);
}

export function publishRefreshFileTree() {
  appEventBus.emit('refresh-file-tree', undefined);
}

export function subscribeRefreshFileTree(listener: () => void) {
  return appEventBus.on('refresh-file-tree', listener);
}

export function publishSessionTabClosed(detail: SessionTabClosedDetail) {
  appEventBus.emit('session-tab-closed', detail);
}

export function subscribeSessionTabClosed(listener: AppEventListener<'session-tab-closed'>) {
  return appEventBus.on('session-tab-closed', listener);
}

export function publishTasksUpdated() {
  appEventBus.emit('tasks-updated', undefined);
}

export function subscribeTasksUpdated(listener: () => void) {
  return appEventBus.on('tasks-updated', listener);
}
