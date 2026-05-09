import { HTMLAttributes, forwardRef } from 'react';
import { cn } from '../../utils/cn';

export interface CardProps extends HTMLAttributes<HTMLDivElement> {}

export const Card = forwardRef<HTMLDivElement, CardProps>(
  ({ className, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn(
          'rounded-xl border',
          'bg-white dark:bg-zinc-900/80',
          'border-zinc-200 dark:border-zinc-800',
          'shadow-sm dark:shadow-none',
          className
        )}
        {...props}
      />
    );
  }
);

Card.displayName = 'Card';

export default Card;
