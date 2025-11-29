import { createFileRoute } from '@tanstack/react-router';
import { Disable } from '../pages/Disable';

export const Route = createFileRoute('/disable')({
  component: Disable,
});
