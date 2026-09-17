/**
 * Fields whose value came from the document reading system are shown in
 * yellow until staff save something else in them (see
 * `Client.documentFilledFields`). One class so every input, select, combobox
 * and textarea looks the same.
 */
export const DOCUMENT_FILLED_CLASS =
  "border-yellow-400 bg-yellow-50 focus-visible:border-yellow-500 dark:border-yellow-600 dark:bg-yellow-950/40";

export const documentFilledClass = (filled: boolean) => (filled ? DOCUMENT_FILLED_CLASS : undefined);
