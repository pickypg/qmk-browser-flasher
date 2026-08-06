/** Extension checks for a firmware file — pure so they're testable
 * without a DOM. `.uf2` will get its own check once that parser exists. */
export function isBinFile(file: File): boolean {
  return file.name.toLowerCase().endsWith(".bin");
}

export function isHexFile(file: File): boolean {
  return file.name.toLowerCase().endsWith(".hex");
}

/** Wires drag/drop plus the existing browse-button `<input type=file>` onto
 * a dropzone container: highlights on drag-over, forwards an accepted file
 * to `onFile`, and reports a rejected (non-.bin/.hex) file via `onRejected`
 * instead of silently ignoring it. */
export function wireDropzone(container: HTMLElement, input: HTMLInputElement, onFile: (file: File) => void, onRejected: (message: string) => void): void {
  const setDragOver = (over: boolean): void => {
    container.classList.toggle("drag-over", over);
  };

  const handleFile = (file: File): void => {
    if (!isBinFile(file) && !isHexFile(file)) {
      onRejected(`"${file.name}" is not a .bin or .hex file.`);
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
