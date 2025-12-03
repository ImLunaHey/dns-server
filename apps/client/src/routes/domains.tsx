import { createFileRoute } from '@tanstack/react-router';
import { Domains } from '../pages/Domains';

export const Route = createFileRoute('/domains')({
  component: Domains,
});

