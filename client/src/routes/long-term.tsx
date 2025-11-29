import { createFileRoute } from '@tanstack/react-router';
import { LongTerm } from '../pages/LongTerm';

export const Route = createFileRoute('/long-term')({
  component: LongTerm,
});

