/** Extension check for a firmware file — pure so it's testable without a
 * DOM. Only `.bin` is currently supported (see core/firmware-parser/bin.ts);
 * `.hex`/`.uf2` will get their own checks once those parsers exist. */
export function isBinFile(file: File): boolean {
  return file.name.toLowerCase().endsWith(".bin");
}

/** Wires drag/drop plus the existing browse-button `<input type=file>` onto
 * a dropzone container: highlights on drag-over, forwards an accepted file
 * to `onFile`, and reports a rejected (non-.bin) file via `onRejected`
 * instead of silently ignoring it. */
export function wireDropzone(container: HTMLElement, input: HTMLInputElement, onFile: (file: File) => void, onRejected: (message: string) => void): void {
  const setDragOver = (over: boolean): void => {
    container.classList.toggle("drag-over", over);
  };

  const handleFile = (file: File): void => {
    if (!isBinFile(file)) {
      onRejected(`"${file.name}" is not a .bin file.`);
      return;
    }
    onFile(file);
  };

  container.addEventListener("dragenter", (event) => {
    event.preventDefault();
    setDragOver(true);
  });

  container.addEventListener("dragover", (event) => {
    event.preventDefault();
    setDragOver(true);
  });

  container.addEventListener("dragleave", (event) => {
    event.preventDefault();
    const related = event.relatedTarget;
    if (!(related instanceof Node) || !container.contains(related)) {
      setDragOver(false);
    }
  });

  container.addEventListener("drop", (event) => {
    event.preventDefault();
    setDragOver(false);
    const file = event.dataTransfer?.files?.[0];
    if (file) {
      handleFile(file);
    }
  });

  input.addEventListener("change", () => {
    const file = input.files?.[0];
    if (file) {
      handleFile(file);
    }
  });
}
