import { useRef, type RefObject } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { useI18n } from '../../lib/i18n';

const button = 'inline-flex min-h-10 items-center justify-center rounded-full px-4 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary';

export function ConfirmDialog({ open, onOpenChange, title, description, confirmLabel, onConfirm, returnFocus }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel: string;
  onConfirm: () => void;
  returnFocus: RefObject<HTMLElement | null>;
}) {
  const { t } = useI18n();
  const cancel = useRef<HTMLButtonElement>(null);
  return <Dialog.Root open={open} onOpenChange={onOpenChange}>
    <Dialog.Portal>
      <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
      <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl bg-background p-5 text-foreground shadow-xl focus:outline-none" onOpenAutoFocus={event => { event.preventDefault(); cancel.current?.focus(); }} onCloseAutoFocus={event => { event.preventDefault(); returnFocus.current?.focus(); }}>
        <Dialog.Title className="text-base font-medium">{title}</Dialog.Title>
        <Dialog.Description className="mt-2 text-sm leading-6 text-muted-foreground">{description}</Dialog.Description>
        <div className="mt-6 flex flex-wrap justify-end gap-2">
          <Dialog.Close ref={cancel} className={`${button} bg-muted hover:bg-secondary`}>{t('取消', 'Cancel')}</Dialog.Close>
          <button type="button" className={`${button} bg-primary text-primary-foreground hover:bg-primary/90`} onClick={() => { onOpenChange(false); onConfirm(); }}>{confirmLabel}</button>
        </div>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
