import { createFileRoute } from '@tanstack/react-router';
import { Activity, ChevronRight, Pause, Play, Trash2 } from 'lucide-react';
import {
    type ReactElement,
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
} from 'react';
import { Badge, type BadgeProps } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Checkbox } from '../components/ui/checkbox';
import { EmptyState } from '../components/ui/empty-state';
import { Label } from '../components/ui/label';
import { isEventMessage, useWebSocket } from '../lib/hooks/use-websocket';
import { cn } from '../lib/utils';
import type { ServerEventMessage } from '../lib/websocket';

const EVENTS_PAGE_NAME = 'EventsPage';

// * Configuration

const BUFFER_CAP = 500;
const RENDER_INTERVAL_MS = 200;

type EventCategory = 'node' | 'task' | 'application' | 'repository' | 'custom' | 'other';

const CATEGORY_PREFIX: Record<Exclude<EventCategory, 'other'>, string> = {
    node: 'node.',
    task: 'task.',
    application: 'application.',
    repository: 'repository.',
    custom: 'custom.',
};

const CATEGORY_LABEL: Record<EventCategory, string> = {
    node: 'Node',
    task: 'Task',
    application: 'Application',
    repository: 'Repository',
    custom: 'Custom',
    other: 'Other',
};

const CATEGORY_VARIANT: Record<EventCategory, BadgeProps['variant']> = {
    node: 'default',
    task: 'secondary',
    application: 'outline',
    repository: 'default',
    custom: 'secondary',
    other: 'outline',
};

const ALL_CATEGORIES: EventCategory[] = [
    'node',
    'task',
    'application',
    'repository',
    'custom',
    'other',
];

// * Event helpers

type EventEntry = ServerEventMessage & { entryId: number };

function categorize(type: string): EventCategory {
    for (const key of Object.keys(CATEGORY_PREFIX) as (keyof typeof CATEGORY_PREFIX)[]) {
        if (type.startsWith(CATEGORY_PREFIX[key])) return key;
    }
    return 'other';
}

function formatTime(timestamp: number): string {
    const d = new Date(timestamp);
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    const ss = String(d.getSeconds()).padStart(2, '0');
    const ms = String(d.getMilliseconds()).padStart(3, '0');
    return `${hh}:${mm}:${ss}.${ms}`;
}

function summarize(event: EventEntry): string {
    const { data } = event;
    const nodes = data.nodes;
    if (Array.isArray(nodes) && nodes.length > 0) {
        const first = nodes[0] as { path?: string; id?: string };
        const extra = nodes.length > 1 ? ` +${nodes.length - 1}` : '';
        const label = first.path ?? first.id ?? '';
        return `${label}${extra}`;
    }
    if (typeof data.id === 'string') return data.id;
    if (typeof data.name === 'string') return data.name;
    if (typeof data.state === 'string') return data.state;
    return '';
}

// * EventRow

type EventRowProps = {
    event: EventEntry;
};

const EVENT_ROW_NAME = 'EventRow';

const EventRow = ({ event }: EventRowProps): ReactElement => {
    const [expanded, setExpanded] = useState(false);
    const category = categorize(event.type);

    return (
        <li
            data-component={EVENT_ROW_NAME}
            className="border-border border-b last:border-b-0"
        >
            <button
                type="button"
                onClick={() => setExpanded((prev) => !prev)}
                className={cn(
                    'flex w-full items-center gap-3 px-4 py-1.5 text-left',
                    'hover:bg-row-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
                )}
                aria-expanded={expanded}
            >
                <ChevronRight
                    className={cn(
                        'size-3.5 shrink-0 text-muted-foreground transition-transform',
                        expanded && 'rotate-90',
                    )}
                />
                <span className="shrink-0 font-mono text-muted-foreground text-xs">
                    {formatTime(event.timestamp)}
                </span>
                <Badge variant={CATEGORY_VARIANT[category]} className="shrink-0">
                    {event.type}
                </Badge>
                <span className="truncate font-mono text-foreground text-xs">
                    {summarize(event)}
                </span>
                {event.distributed && (
                    <Badge variant="outline" className="ml-auto shrink-0">
                        distributed
                    </Badge>
                )}
            </button>
            {expanded && (
                <pre className="overflow-x-auto bg-muted/40 px-4 py-2 font-mono text-foreground text-xs">
                    {JSON.stringify(event.data, null, 2)}
                </pre>
            )}
        </li>
    );
};

EventRow.displayName = EVENT_ROW_NAME;

// * EventsPage

type Snapshot = {
    events: EventEntry[];
    total: number;
};

const EMPTY_SNAPSHOT: Snapshot = { events: [], total: 0 };

const EventsPage = (): ReactElement => {
    const { status, subscribe } = useWebSocket();
    const [paused, setPaused] = useState(false);
    const [enabledCategories, setEnabledCategories] = useState<Set<EventCategory>>(
        () => new Set(ALL_CATEGORIES),
    );
    const [snapshot, setSnapshot] = useState<Snapshot>(EMPTY_SNAPSHOT);

    const bufferRef = useRef<EventEntry[]>([]);
    const totalRef = useRef(0);
    const entryIdRef = useRef(0);

    useEffect(() => {
        const unsubscribe = subscribe((message) => {
            if (!isEventMessage(message)) return;

            entryIdRef.current += 1;
            totalRef.current += 1;

            const entry: EventEntry = {
                ...message,
                entryId: entryIdRef.current,
            };

            const buf = bufferRef.current;
            buf.push(entry);
            if (buf.length > BUFFER_CAP) {
                buf.shift();
            }
        });
        return unsubscribe;
    }, [subscribe]);

    useEffect(() => {
        if (paused) return;
        const id = window.setInterval(() => {
            setSnapshot({
                events: bufferRef.current.slice(),
                total: totalRef.current,
            });
        }, RENDER_INTERVAL_MS);
        return () => window.clearInterval(id);
    }, [paused]);

    const handleToggleCategory = useCallback(
        (category: EventCategory, checked: boolean) => {
            setEnabledCategories((prev) => {
                const next = new Set(prev);
                if (checked) next.add(category);
                else next.delete(category);
                return next;
            });
        },
        [],
    );

    const handleClear = useCallback(() => {
        bufferRef.current = [];
        setSnapshot({ events: [], total: totalRef.current });
    }, []);

    const handleTogglePause = useCallback(() => {
        setPaused((prev) => {
            const next = !prev;
            if (!next) {
                // ? Resuming: flush current buffer immediately.
                setSnapshot({
                    events: bufferRef.current.slice(),
                    total: totalRef.current,
                });
            }
            return next;
        });
    }, []);

    const visibleEvents = useMemo(() => {
        const events = snapshot.events;
        const filtered = events.filter((e) => enabledCategories.has(categorize(e.type)));
        // ? Display newest-first without mutating the buffer.
        return filtered.slice().reverse();
    }, [snapshot.events, enabledCategories]);

    const statusBadge = (
        <Badge
            variant={
                status === 'open'
                    ? 'default'
                    : status === 'connecting'
                      ? 'outline'
                      : 'destructive'
            }
        >
            {status === 'open' ? 'Live' : status === 'connecting' ? 'Connecting' : 'Offline'}
        </Badge>
    );

    return (
        <div data-component={EVENTS_PAGE_NAME} className="flex h-full flex-col">
            {/* Header */}
            <div className="flex h-10 shrink-0 items-center justify-between gap-2 overflow-x-auto border-border border-b bg-card px-4">
                <span className="font-medium font-mono text-foreground text-xs">Events</span>
                <div className="flex items-center gap-2">
                    <span className="text-muted-foreground text-xs">
                        {snapshot.total} received · showing {visibleEvents.length} of{' '}
                        {snapshot.events.length}
                    </span>
                    {statusBadge}
                </div>
            </div>

            {/* Toolbar */}
            <div className="flex flex-wrap items-center gap-3 border-border border-b bg-card px-4 py-2">
                <Button
                    variant={paused ? 'primary' : 'ghost'}
                    size="sm"
                    onClick={handleTogglePause}
                    aria-pressed={paused}
                >
                    {paused ? <Play className="size-4" /> : <Pause className="size-4" />}
                    {paused ? 'Resume' : 'Pause'}
                </Button>
                <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleClear}
                    disabled={snapshot.events.length === 0}
                >
                    <Trash2 className="size-4" />
                    Clear
                </Button>

                <div className="mx-2 h-5 w-px bg-border" />

                {ALL_CATEGORIES.map((category) => {
                    const id = `events-filter-${category}`;
                    return (
                        <div key={category} className="flex items-center gap-1.5">
                            <Checkbox
                                id={id}
                                checked={enabledCategories.has(category)}
                                onCheckedChange={(checked) =>
                                    handleToggleCategory(category, checked === true)
                                }
                            />
                            <Label htmlFor={id} className="cursor-pointer text-xs">
                                {CATEGORY_LABEL[category]}
                            </Label>
                        </div>
                    );
                })}
            </div>

            {/* Event log */}
            {visibleEvents.length === 0 ? (
                <EmptyState
                    icon={Activity}
                    title={
                        snapshot.events.length === 0
                            ? 'No events yet'
                            : 'No events match filters'
                    }
                    description={
                        snapshot.events.length === 0
                            ? 'Live XP events will appear here as they happen.'
                            : 'Adjust the type filters to see more events.'
                    }
                />
            ) : (
                <ol className="flex-1 overflow-y-auto">
                    {visibleEvents.map((event) => (
                        <EventRow key={event.entryId} event={event} />
                    ))}
                </ol>
            )}
        </div>
    );
};

EventsPage.displayName = EVENTS_PAGE_NAME;

export const Route = createFileRoute('/events')({
    component: EventsPage,
});
