import { createFileRoute } from '@tanstack/react-router';
import { Shield } from 'lucide-react';
import type { ReactElement } from 'react';
import { EmptyState } from '../components/ui/empty-state';

const AUDIT_PAGE_NAME = 'AuditPage';

const AuditPage = (): ReactElement => {
    return (
        <div
            data-component={AUDIT_PAGE_NAME}
            className="flex h-full items-center justify-center"
        >
            <EmptyState
                icon={Shield}
                title="Audit"
                description="Audit log viewer coming soon."
            />
        </div>
    );
};

AuditPage.displayName = AUDIT_PAGE_NAME;

export const Route = createFileRoute('/audit')({
    component: AuditPage,
});
