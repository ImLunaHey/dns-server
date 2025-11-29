import { createFileRoute } from '@tanstack/react-router';
import { ApiKeys } from '../pages/ApiKeys';

export const Route = createFileRoute('/api-keys')({
  component: ApiKeys,
});

