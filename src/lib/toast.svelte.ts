export type ToastTone = 'success' | 'error' | 'info';

class Toasts {
  message = $state('');
  tone = $state<ToastTone>('success');
  visible = $state(false);
  #timer: ReturnType<typeof setTimeout> | 0 = 0;

  show(message: string, tone: ToastTone = 'success', ms = 3600) {
    this.message = message;
    this.tone = tone;
    this.visible = true;
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = setTimeout(() => { this.visible = false; }, ms);
  }
}

export const toasts = new Toasts();
export const showToast = (message: string, tone: ToastTone = 'success') => toasts.show(message, tone);
