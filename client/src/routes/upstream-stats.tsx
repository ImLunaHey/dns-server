import { createFileRoute } from '@tanstack/react-router';
import { UpstreamStats } from '../pages/UpstreamStats';

export const Route = createFileRoute('/upstream-stats')({
  component: UpstreamStats,
});

