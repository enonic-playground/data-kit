import { createFileRoute } from '@tanstack/react-router';
import type { ReactElement } from 'react';

const SEARCH_PAGE_NAME = 'SearchPage';

const SearchPage = (): ReactElement => {
    return (
        <div data-component={SEARCH_PAGE_NAME} className="p-6">
            <h2 className="font-semibold text-2xl">Search</h2>
            <p className="mt-2 text-muted-foreground">
                Search nodes with NoQL here.
            </p>
        </div>
    );
};

SearchPage.displayName = SEARCH_PAGE_NAME;

export const Route = createFileRoute('/search')({
    component: SearchPage,
});
