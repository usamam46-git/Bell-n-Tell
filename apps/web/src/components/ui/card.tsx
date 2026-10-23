import * as React from 'react';
import { cn } from '@/lib/utils';
export function Card({ className, ...props }: React.ComponentProps<'section'>) { return <section className={cn('rounded-xl border border-stone-200 bg-white p-6 shadow-sm', className)} {...props} />; }
