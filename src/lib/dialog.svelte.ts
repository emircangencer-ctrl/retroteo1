// In-app confirmation dialog (instead of window.confirm, which looks foreign and blocks gamepads).
export interface DialogRequest {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  /** Extra lines shown as a compact list (for example a backup preview). */
  details?: string[];
  /** Only one button ("Tamam"). */
  alert?: boolean;
}

class Dialogs {
  current = $state<(DialogRequest & { resolve: (ok: boolean) => void }) | null>(null);

  ask(request: DialogRequest): Promise<boolean> {
    this.current?.resolve(false);
    return new Promise(resolve => { this.current = { ...request, resolve }; });
  }

  answer(ok: boolean) {
    const current = this.current;
    this.current = null;
    current?.resolve(ok);
  }
}

export const dialogs = new Dialogs();
export const confirmDialog = (request: DialogRequest) => dialogs.ask(request);
export const alertDialog = (request: Omit<DialogRequest, 'alert'>) => dialogs.ask({ ...request, alert: true });
