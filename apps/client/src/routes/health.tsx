import { createFileRoute } from '@tanstack/react-router';
import { Health } from '../pages/Health';

export const Route = createFileRoute('/health')({
  component: Health,
});

