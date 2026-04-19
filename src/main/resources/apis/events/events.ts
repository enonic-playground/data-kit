import type { Request, Response, WebSocketEvent } from '@enonic-types/core';
import { listener } from '/lib/xp/event';
import { addToGroup, send, sendToGroup } from '/lib/xp/websocket';
import { errorResponse, requireAdmin } from '../../lib/api';

const EVENT_GROUP = 'datakit.events';

type ServerMessage =
    | { kind: 'ready' }
    | { kind: 'pong' }
    | {
          kind: 'event';
          type: string;
          timestamp: number;
          localOrigin: boolean;
          distributed: boolean;
          data: Record<string, unknown>;
      };

type ClientMessage = { type: 'ping' } | { type: 'subscribe'; types?: string[] };

// ? Registered once at module load so XP event subscription survives across
// ? individual WebSocket connections. Clients filter types on their side.
let listenerRegistered = false;

function registerXpEventListener(): void {
    if (listenerRegistered) return;
    listenerRegistered = true;

    listener<Record<string, unknown>>({
        type: '*',
        localOnly: false,
        callback: (event) => {
            const payload: ServerMessage = {
                kind: 'event',
                type: event.type,
                timestamp: event.timestamp,
                localOrigin: event.localOrigin,
                distributed: event.distributed,
                data: event.data,
            };
            try {
                sendToGroup(EVENT_GROUP, JSON.stringify(payload));
            } catch (_e) {
                // ? Group may be empty; swallow so the listener keeps running.
            }
        },
    });
}

registerXpEventListener();

export function get(req: Request): Response {
    const forbidden = requireAdmin();
    if (forbidden != null) return forbidden;

    if (!req.webSocket) {
        return errorResponse(404, 'WebSocket upgrade required', 'NOT_FOUND');
    }

    return {
        status: 101,
        webSocket: {
            subProtocols: ['datakit-events-v1'],
        },
    } as Response;
}

export function webSocketEvent(event: WebSocketEvent<Record<string, unknown>>): void {
    switch (event.type) {
        case 'open':
            addToGroup(EVENT_GROUP, event.session.id);
            sendServer(event.session.id, { kind: 'ready' });
            break;
        case 'message':
            handleMessage(event);
            break;
        case 'close':
        case 'error':
            break;
    }
}

function handleMessage(event: WebSocketEvent<Record<string, unknown>>): void {
    const msg = parseMessage(event.message);
    if (msg == null) return;

    if (msg.type === 'ping') {
        sendServer(event.session.id, { kind: 'pong' });
    }
}

function parseMessage(raw: string | undefined): ClientMessage | undefined {
    if (raw == null) return undefined;
    try {
        const parsed = JSON.parse(raw) as ClientMessage;
        return parsed != null && typeof parsed === 'object' && 'type' in parsed
            ? parsed
            : undefined;
    } catch (_e) {
        return undefined;
    }
}

function sendServer(sessionId: string, message: ServerMessage): void {
    send(sessionId, JSON.stringify(message));
}
