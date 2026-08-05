export interface ErrorScreenOptions {
  readonly title: string;
  readonly message: string;
  readonly retryLabel: string;
  readonly onRetry: () => void;
}

/** Renders a failure (protocol error, verification mismatch, or disconnect)
 * with a retry action wired up — self-contained like dropzone.ts's
 * wireDropzone, so the caller doesn't need to re-query the button after
 * every render. See docs/SAFETY.md for why every failure here is safe to
 * retry from scratch. */
export function renderErrorScreen(container: HTMLElement, options: ErrorScreenOptions): void {
  container.innerHTML = `
    <p class="result-text error">${options.title}</p>
    <p class="result-detail">${options.message}</p>
    <button type="button" class="primary">${options.retryLabel}</button>
  `;
  container.querySelector("button")!.addEventListener("click", options.onRetry);
}
