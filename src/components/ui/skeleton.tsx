import { cn } from '@/lib/utils';

function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('animate-pulse rounded-md bg-[var(--loading-skeleton-from)]', className)}
      style={{
        backgroundImage: 'linear-gradient(90deg, var(--loading-skeleton-from) 0%, var(--loading-skeleton-to) 50%, var(--loading-skeleton-from) 100%)',
        backgroundSize: '200% 100%',
        animation: 'shimmer 2s infinite',
      }}
      {...props}
    />
  );
}

export { Skeleton };
