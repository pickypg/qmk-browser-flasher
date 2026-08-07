/** Extension checks for a firmware file — pure so they're testable
 * without a DOM. */
export function isBinFile(file: File): boolean {
  return file.name.toLowerCase().endsWith(".bin");
}

export function isHexFile(file: File): boolean {
  return file.name.toLowerCase().endsWith(".hex");
}

export function isUf2File(file: File): boolean {
  return file.name.toLowerCase().endsWith(".uf2");
}

/** Wires drag/drop plus the existing browse-button `<input type=file>` onto
 * a dropzone container: highlights on drag-over, forwards an accepted file
 * to `onFile`, and reports a rejected (non-.bin/.hex/.uf2) file via
 * `onRejected` instead of silently ignoring it. */
export function wireDropzone(container: HTMLElement, input: HTMLInputElement, onFile: (file: File) => void, onRejected: (message: string) => void): void {
  const setDragOver = (over: boolean): void => {
    container.classList.toggle("drag-over", over);
  };

  const handleFile = (file: File): void => {
    if (!isBinFile(file) && !isHexFile(file) && !isUf2File(file)) {
      onRejected(`"${file.name}" is not a .bin, .hex, or .uf2 file.`);
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
