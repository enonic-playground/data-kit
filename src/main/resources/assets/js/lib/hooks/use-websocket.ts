import { useEffect, useMemo, useRef, useState } from 'react';

import { getConfig } from '../config';
import {
  type ServerEventMessage,
  type ServerMessage,
  toWebSocketUrl,
  WebSocketClient,
  type WebSocketStatus,
} from '../websocket';

type Listener = (message: ServerMessage) => void;

let clientInstance: WebSocketClient | undefined;
let activeRefs = 0;

function getSharedClient(): WebSocketClient {
  if (clientInstance == null) {
    const { events } = getConfig().apiUris;
    clientInstance = new WebSocketClient({
      url: toWebSocketUrl(events),
      protocols: ['datakit-events-v1'],
    });
  }
  return clientInstance;
}

function acquireClient(): WebSocketClient {
  const client = getSharedClient();
  activeRefs += 1;
  if (activeRefs === 1) {
    client.connect();
  }
  return client;
}

function releaseClient(): void {
  activeRefs -= 1;
  if (activeRefs <= 0 && clientInstance != null) {
    activeRefs = 0;
    clientInstance.close();
    clientInstance = undefined;
  }
}

export type UseWebSocketResult = {
  status: WebSocketStatus;
  subscribe: (listener: Listener) => () => void;
};

export function useWebSocket(): UseWebSocketResult {
  const [status, setStatus] = useState<WebSocketStatus>('idle');
  const clientRef = useRef<WebSocketClient | undefined>(undefined);

  useEffect(() => {
    const client = acquireClient();
    clientRef.current = client;
    const unsubscribe = client.onStatus(setStatus);

    return () => {
      unsubscribe();
      clientRef.current = undefined;
      releaseClient();
    };
  }, []);

  const subscribe = useMemo<UseWebSocketResult['subscribe']>(
    () => (listener) => {
      const client = clientRef.current ?? getSharedClient();
      return client.subscribe(listener);
    },
    [],
  );

  return { status, subscribe };
}

export function isEventMessage(message: ServerMessage): message is ServerEventMessage {
  return message.kind === 'event';
}
