import { useCallback, useEffect, useRef, useState } from 'react';
import { requestTributeState, TributeRequestError, type TributeStats } from '../lib/tribute-client';

type Phase = 'initializing' | 'ready' | 'submitting' | 'joined' | 'error';

export function useTribute() {
  const [stats, setStats] = useState<TributeStats | null>(null);
  const [phase, setPhase] = useState<Phase>('initializing');
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const alive = useRef(false);
  const state = useRef<TributeStats | null>(null);
  const lastUpdated = useRef(0);
  const sequence = useRef(0);
  const appliedSequence = useRef(0);
  const joining = useRef<Promise<boolean> | null>(null);
  const refreshing = useRef<Promise<void> | null>(null);
  const controllers = useRef(new Set<AbortController>());

  const apply = useCallback((data: TributeStats, requestSequence: number) => {
    if (!alive.current || requestSequence < appliedSequence.current) return;
    appliedSequence.current = requestSequence;
    // A confirmed contribution remains confirmed if an earlier heartbeat races it.
    const next = { ...data, participated: data.participated || Boolean(state.current?.participated) };
    state.current = next;
    lastUpdated.current = Date.now();
    setStats(next);
    setStale(false);
  }, []);

  const refresh = useCallback((interactive = false): Promise<void> => {
    if (refreshing.current) return refreshing.current;
    if (joining.current) return Promise.resolve();
    const requestSequence = ++sequence.current;
    const controller = new AbortController();
    controllers.current.add(controller);
    if (interactive) { setError(null); setPhase('initializing'); }
    let pending!: Promise<void>;
    pending = (async () => {
      try {
        const data = await requestTributeState('presence', controller.signal);
        if (!alive.current || controller.signal.aborted) return;
        apply(data, requestSequence);
        if (!joining.current) {
          setPhase(state.current?.participated ? 'joined' : 'ready');
          setError(null);
        }
      } catch (cause) {
        if (!alive.current || controller.signal.aborted) return;
        if (!state.current || interactive) {
          setPhase('error');
          setError(cause instanceof Error ? cause.message : 'We couldn’t connect. Please try again.');
        }
        if (lastUpdated.current && Date.now() - lastUpdated.current > 90_000) setStale(true);
      } finally {
        controllers.current.delete(controller);
        if (refreshing.current === pending) refreshing.current = null;
      }
    })();
    refreshing.current = pending;
    return pending;
  }, [apply]);

  const join = useCallback((): Promise<boolean> => {
    if (joining.current) return joining.current;
    if (state.current?.participated) return Promise.resolve(false);
    if (!state.current) { void refresh(true); return Promise.resolve(false); }
    const requestSequence = ++sequence.current;
    const controller = new AbortController();
    controllers.current.add(controller);
    setPhase('submitting');
    setError(null);
    let pending!: Promise<boolean>;
    pending = (async () => {
      try {
        const data = await requestTributeState('tribute', controller.signal);
        if (!alive.current || controller.signal.aborted) return false;
        apply(data, requestSequence);
        setPhase(data.participated ? 'joined' : 'ready');
        return data.added === true;
      } catch (cause) {
        if (!alive.current || controller.signal.aborted) return false;
        if (cause instanceof TributeRequestError && cause.code === 'SESSION_REQUIRED') state.current = null;
        setPhase('error');
        setError(cause instanceof Error ? cause.message : 'Your tribute hasn’t been saved. Please try again.');
        return false;
      } finally {
        controllers.current.delete(controller);
        if (joining.current === pending) joining.current = null;
      }
    })();
    joining.current = pending;
    return pending;
  }, [apply, refresh]);

  useEffect(() => {
    alive.current = true;
    void refresh();
    const heartbeat = setInterval(() => {
      if (document.visibilityState === 'visible') void refresh();
    }, 30_000);
    const freshness = setInterval(() => {
      if (lastUpdated.current && Date.now() - lastUpdated.current > 90_000) setStale(true);
    }, 5_000);
    const visible = () => { if (document.visibilityState === 'visible') void refresh(); };
    document.addEventListener('visibilitychange', visible);
    window.addEventListener('online', visible);
    return () => {
      alive.current = false;
      for (const controller of controllers.current) controller.abort();
      controllers.current.clear();
      refreshing.current = null;
      joining.current = null;
      clearInterval(heartbeat);
      clearInterval(freshness);
      document.removeEventListener('visibilitychange', visible);
      window.removeEventListener('online', visible);
    };
  }, [refresh]);

  return { stats, phase, error, stale, join, retry: () => refresh(true) };
}
