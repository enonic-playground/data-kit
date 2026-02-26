import { createFileRoute, Outlet } from '@tanstack/react-router';

export const Route = createFileRoute('/repositories/$repoId')({
    component: Outlet,
});
