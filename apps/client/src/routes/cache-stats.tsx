import { createFileRoute } from '@tanstack/react-router';
import { CacheStats } from '../pages/CacheStats';

export const Route = createFileRoute('/cache-stats')({
  component: CacheStats,
});

