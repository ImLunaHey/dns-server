import { createFileRoute } from '@tanstack/react-router';
import { QueryLogPage } from '../pages/QueryLogPage';

export const Route = createFileRoute('/queries')({
  component: QueryLogPage,
  validateSearch: (search: Record<string, unknown>) => {
    return {
      clientIp: (search.clientIp as string) || undefined,
    };
  },
});

