import { createFileRoute } from '@tanstack/react-router';
import { LocalDNS } from '../pages/LocalDNS';

export const Route = createFileRoute('/local-dns')({
  component: LocalDNS,
});

