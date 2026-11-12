import { useCallback, useEffect, useRef, useState } from 'react';
import {
  MessageDraftRequests,
  MessageRequestError,
  mergeAcknowledgedMessage,
  postMessage,
  readMessages,
  type MessageAcknowledgement,
  type PublicMessage,
} from '../lib/messages-client';
import { requestTributeState } from '../lib/tribute-client';

export function useMessages() {
  const [messages, setMessages] = useState<PublicMessage[]>([]);
  const [totalMessages, setTotalMessages] = useState(0);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(false);
  const generation = useRef(0);
  const sequence = useRef(0);
  const appliedSequence = useRef(0);
  const loaded = useRef(false);
  const currentMessages = useRef<PublicMessage[]>([]);
  const postError = useRef<string | null>(null);
  const drafts = useRef(new MessageDraftRequests());
  const refreshing = useRef<Promise<void> | null>(null);
  const posting = useRef<Promise<boolean> | null>(null);
  const getController = useRef<AbortController | null>(null);
  const controllers = useRef(new Set<AbortController>());

  const refresh = useCallback((): Promise<void> => {
    if (!alive.current || posting.current) return Promise.resolve();
    if (refreshing.current) return refreshing.current;
    const requestSequence = ++sequence.current;
    const requestGeneration = generation.current;
    const controller = new AbortController();
    controllers.current.add(controller);
    getController.current = controller;
    if (!loaded.current) setLoading(true);
    const canApply = () => alive.current && generation.current === requestGeneration
      && !controller.signal.aborted && requestSequence >= appliedSequence.current;
    let pending!: Promise<void>;
    pending = (async () => {
      try {
        const result = await readMessages(controller.signal);
        if (!canApply()) return;
        appliedSequence.current = requestSequence;
        loaded.current = true;
        currentMessages.current = result.messages;
        setMessages(result.messages);
        setTotalMessages(result.totalMessages);
        // A successful poll does not acknowledge an unsuccessful submission.
        if (!postError.current) setError(null);
      } catch (cause) {
        if (!canApply()) return;
        if (!postError.current) {
          setError(cause instanceof MessageRequestError ? cause.message : 'We couldn’t connect to the message wall. Please try again.');
        }
      } finally {
        controllers.current.delete(controller);
        if (getController.current === controller) getController.current = null;
        if (refreshing.current === pending) refreshing.current = null;
        if (canApply()) setLoading(false);
      }
    })();
    refreshing.current = pending;
    return pending;
  }, []);

  const sendMessage = useCallback((name: string, body: string): Promise<boolean> => {
    if (!alive.current) return Promise.resolve(false);
    if (posting.current) return posting.current;
    let submission;
    try {
      submission = drafts.current.forDraft(name, body);
    } catch (cause) {
      postError.current = cause instanceof MessageRequestError ? cause.message : 'We couldn’t prepare your message. Please refresh and try again.';
      setError(postError.current);
      return Promise.resolve(false);
    }

    const requestSequence = ++sequence.current;
    const requestGeneration = generation.current;
    // Invalidate reads immediately, even if this write later fails or times out.
    appliedSequence.current = requestSequence;
    getController.current?.abort();
    getController.current = null;
    refreshing.current = null;
    const controller = new AbortController();
    controllers.current.add(controller);
    postError.current = null;
    setError(null);
    setSending(true);
    const canApply = () => alive.current && generation.current === requestGeneration
      && !controller.signal.aborted && requestSequence >= appliedSequence.current;
    let pending!: Promise<boolean>;
    pending = (async () => {
      try {
        let result: MessageAcknowledgement;
        try {
          result = await postMessage(submission, controller.signal);
        } catch (cause) {
          if (!(cause instanceof MessageRequestError) || cause.code !== 'SESSION_REQUIRED') throw cause;
          if (!canApply()) return false;
          // Recover an expired or not-yet-established visit in place. Keep the
          // prepared request intact so reconnecting never creates a new draft ID.
          try {
            await requestTributeState('presence', controller.signal);
          } catch {
            throw new MessageRequestError('We couldn’t reconnect your visit. Please try again; your message stays here.', 'SESSION_REQUIRED');
          }
          if (!canApply()) return false;
          result = await postMessage(submission, controller.signal);
        }
        if (!canApply()) return false;
        drafts.current.acknowledge(submission.requestId);
        appliedSequence.current = requestSequence;
        loaded.current = true;
        currentMessages.current = mergeAcknowledgedMessage(currentMessages.current, result);
        setMessages(currentMessages.current);
        setTotalMessages(result.totalMessages);
        postError.current = null;
        setError(null);
        // A duplicate acknowledgement also confirms a previously uncertain post.
        return true;
      } catch (cause) {
        if (!canApply()) return false;
        postError.current = cause instanceof MessageRequestError ? cause.message
          : 'We couldn’t confirm your message. Please try again with the same text.';
        setError(postError.current);
        return false;
      } finally {
        controllers.current.delete(controller);
        if (posting.current === pending) posting.current = null;
        if (canApply()) {
          setSending(false);
          setLoading(false);
          void refresh();
        }
      }
    })();
    posting.current = pending;
    return pending;
  }, [refresh]);

  useEffect(() => {
    generation.current += 1;
    alive.current = true;
    setSending(false);
    void refresh();
    const poll = setInterval(() => {
      if (document.visibilityState === 'visible') void refresh();
    }, 15_000);
    const visible = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    document.addEventListener('visibilitychange', visible);
    window.addEventListener('online', visible);
    return () => {
      alive.current = false;
      generation.current += 1;
      for (const controller of controllers.current) controller.abort();
      controllers.current.clear();
      getController.current = null;
      refreshing.current = null;
      posting.current = null;
      clearInterval(poll);
      document.removeEventListener('visibilitychange', visible);
      window.removeEventListener('online', visible);
    };
  }, [refresh]);

  return { messages, totalMessages, loading, sending, error, sendMessage, refresh };
}
