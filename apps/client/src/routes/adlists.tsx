import { createFileRoute } from '@tanstack/react-router';
import { Adlists } from '../pages/Adlists';

export const Route = createFileRoute('/adlists')({
  component: Adlists,
});

