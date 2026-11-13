import * as Dialog from '@radix-ui/react-dialog';
import { forwardRef, type ComponentPropsWithoutRef, type ElementRef } from 'react';

export const Sheet = Dialog.Root;
export const SheetTrigger = Dialog.Trigger;
export const SheetTitle = Dialog.Title;

// The Radix Overlay adds an inline stylesheet for scroll locking. The gateway's
// CSP only permits same-origin stylesheets, so the overlay and scroll lock use
// the application's CSS while Radix provides focus trapping and dismissal.
export const SheetContent = forwardRef<ElementRef<typeof Dialog.Content>, ComponentPropsWithoutRef<typeof Dialog.Content> & { onOverlayClick: () => void }>(
  function SheetContent({ children, className = '', onOverlayClick, ...props }, ref) {
    return <Dialog.Portal>
      <div aria-hidden="true" data-sheet-overlay="" onClick={onOverlayClick} className="pointer-events-auto fixed inset-0 z-40 bg-black/55 lg:hidden" />
      <Dialog.Content ref={ref} aria-describedby={undefined} className={`shell-sidebar pointer-events-auto fixed inset-y-0 left-0 z-50 w-72 max-w-[85vw] overflow-y-auto text-foreground shadow-xl lg:hidden ${className}`} {...props}>
        {children}
      </Dialog.Content>
    </Dialog.Portal>;
  },
);
