export type ServerEventMessage = {
    kind: 'event';
    type: string;
    timestamp: number;
    localOrigin: boolean;
    distributed: boolean;
    data: Record<string, unknown>;
};

export type ServerReadyMessage = { kind: 'ready' };
export type ServerPongMessage = { kind: 'pong' };

export type ServerMessage = ServerEventMessage | ServerReadyMessage | ServerPongMessage;

export type ClientMessage = { type: 'ping' };

export type WebSocketStatus = 'idle' | 'connecting' | 'open' | 'closed';

type Listener = (message: ServerMessage) => void;
type StatusListener = (status: WebSocketStatus) => void;

export type WebSocketClientOptions = {
    url: string;
    protocols?: string[];
    heartbeatIntervalMs?: number;
    reconnectBaseDelayMs?: number;
    reconnectMaxDelayMs?: number;
};

const DEFAULT_HEARTBEAT_MS = 25_000;
const DEFAULT_RECONNECT_BASE_MS = 1_000;
const DEFAULT_RECONNECT_MAX_MS = 30_000;

export class WebSocketClient {
    readonly url: string;
    readonly protocols?: string[];
    private readonly heartbeatMs: number;
    private readonly reconnectBaseMs: number;
    private readonly reconnectMaxMs: number;

    private socket: WebSocket | undefined;
    private status: WebSocketStatus = 'idle';
    private heartbeatTimer: number | undefined;
    private reconnectTimer: number | undefined;
    private reconnectAttempts = 0;
    private closedByUser = false;

    private readonly listeners = new Set<Listener>();
    private readonly statusListeners = new Set<StatusListener>();

    constructor({
        url,
        protocols,
        heartbeatIntervalMs = DEFAULT_HEARTBEAT_MS,
        reconnectBaseDelayMs = DEFAULT_RECONNECT_BASE_MS,
        reconnectMaxDelayMs = DEFAULT_RECONNECT_MAX_MS,
    }: WebSocketClientOptions) {
        this.url = url;
        this.protocols = protocols;
        this.heartbeatMs = heartbeatIntervalMs;
        this.reconnectBaseMs = reconnectBaseDelayMs;
        this.reconnectMaxMs = reconnectMaxDelayMs;
    }

    getStatus(): WebSocketStatus {
        return this.status;
    }

    connect(): void {
        if (this.status === 'connecting' || this.status === 'open') return;
        this.closedByUser = false;
        this.openSocket();
    }

    close(): void {
        this.closedByUser = true;
        this.clearReconnect();
        this.clearHeartbeat();
        if (this.socket != null) {
            try {
                this.socket.close();
            } catch (_e) {
                // ? Calling close on an already-closed socket throws in some browsers.
            }
        }
        this.socket = undefined;
        this.setStatus('closed');
    }

    send(message: ClientMessage): boolean {
        if (this.socket == null || this.socket.readyState !== WebSocket.OPEN) return false;
        this.socket.send(JSON.stringify(message));
        return true;
    }

    subscribe(listener: Listener): () => void {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }

    onStatus(listener: StatusListener): () => void {
        this.statusListeners.add(listener);
        listener(this.status);
        return () => {
            this.statusListeners.delete(listener);
        };
    }

    //
    // * Internals
    //

    private openSocket(): void {
        this.setStatus('connecting');

        let socket: WebSocket;
        try {
            socket = new WebSocket(this.url, this.protocols);
        } catch (_e) {
            this.scheduleReconnect();
            return;
        }
        this.socket = socket;

        socket.addEventListener('open', this.handleOpen);
        socket.addEventListener('message', this.handleMessage);
        socket.addEventListener('error', this.handleError);
        socket.addEventListener('close', this.handleClose);
    }

    private handleOpen = (): void => {
        this.reconnectAttempts = 0;
        this.setStatus('open');
        this.startHeartbeat();
    };

    private handleMessage = (event: MessageEvent<string>): void => {
        let parsed: ServerMessage | undefined;
        try {
            parsed = JSON.parse(event.data) as ServerMessage;
        } catch (_e) {
            return;
        }
        if (parsed?.kind == null) return;
        for (const listener of this.listeners) {
            listener(parsed);
        }
    };

    private handleError = (): void => {
        // ? XP normally follows up with a `close` event — reconnect is scheduled there.
    };

    private handleClose = (): void => {
        this.clearHeartbeat();
        this.socket = undefined;
        this.setStatus('closed');
        if (!this.closedByUser) {
            this.scheduleReconnect();
        }
    };

    private startHeartbeat(): void {
        this.clearHeartbeat();
        this.heartbeatTimer = window.setInterval(() => {
            this.send({ type: 'ping' });
        }, this.heartbeatMs);
    }

    private clearHeartbeat(): void {
        if (this.heartbeatTimer != null) {
            window.clearInterval(this.heartbeatTimer);
            this.heartbeatTimer = undefined;
        }
    }

    private scheduleReconnect(): void {
        this.clearReconnect();
        const attempt = this.reconnectAttempts++;
        const delay = Math.min(this.reconnectBaseMs * 2 ** attempt, this.reconnectMaxMs);
        this.reconnectTimer = window.setTimeout(() => {
            if (!this.closedByUser) this.openSocket();
        }, delay);
    }

    private clearReconnect(): void {
        if (this.reconnectTimer != null) {
            window.clearTimeout(this.reconnectTimer);
            this.reconnectTimer = undefined;
        }
    }

    private setStatus(next: WebSocketStatus): void {
        if (this.status === next) return;
        this.status = next;
        for (const listener of this.statusListeners) {
            listener(next);
        }
    }
}

export function toWebSocketUrl(apiUrl: string): string {
    if (apiUrl.startsWith('ws://') || apiUrl.startsWith('wss://')) return apiUrl;
    if (apiUrl.startsWith('https://')) return `wss://${apiUrl.slice('https://'.length)}`;
    if (apiUrl.startsWith('http://')) return `ws://${apiUrl.slice('http://'.length)}`;
    const absolute = new URL(apiUrl, window.location.origin).toString();
    return toWebSocketUrl(absolute);
}
