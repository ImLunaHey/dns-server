import { createFileRoute } from '@tanstack/react-router';
import { Tools } from '../pages/Tools';

export const Route = createFileRoute('/tools')({
  component: Tools,
  validateSearch: (search: Record<string, unknown>) => {
    return {
      domain: (search.domain as string) || undefined,
      type: (search.type as string) || undefined,
    };
  },
});
