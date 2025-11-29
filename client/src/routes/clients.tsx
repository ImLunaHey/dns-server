import { createFileRoute } from '@tanstack/react-router';
import { Clients } from '../pages/Clients';

export const Route = createFileRoute('/clients')({
  component: Clients,
});

