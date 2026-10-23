import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';
const variants = cva('inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-900 disabled:opacity-50 disabled:pointer-events-none min-h-10 px-4', { variants: { variant: { default: 'bg-stone-900 text-white hover:bg-stone-700', outline: 'border border-stone-300 bg-white hover:bg-stone-100', ghost: 'hover:bg-stone-100' } }, defaultVariants: { variant: 'default' } });
export function Button({ className, variant, asChild = false, ...props }: React.ComponentProps<'button'> & VariantProps<typeof variants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : 'button';
  return <Comp className={cn(variants({ variant }), className)} {...props} />;
}
