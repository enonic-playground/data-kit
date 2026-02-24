import { createFileRoute } from '@tanstack/react-router';
import type { ReactElement } from 'react';

const AUDIT_PAGE_NAME = 'AuditPage';

const AuditPage = (): ReactElement => {
    return (
        <div data-component={AUDIT_PAGE_NAME} className="p-6">
            <h2 className="font-semibold text-2xl">Audit</h2>
            <p className="mt-2 text-muted-foreground">
                View audit logs here.
            </p>
        </div>
    );
};

AuditPage.displayName = AUDIT_PAGE_NAME;

export const Route = createFileRoute('/audit')({
    component: AuditPage,
});
