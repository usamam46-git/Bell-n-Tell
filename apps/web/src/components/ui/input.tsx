import * as React from 'react';
import { cn } from '@/lib/utils';
export function Input({ className, ...props }: React.ComponentProps<'input'>) { return <input className={cn('w-full min-h-10 rounded-md border border-stone-300 bg-white px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-900', className)} {...props} />; }
