/** Orange dot after a label: the field is needed before the case can be submitted. */
export function RequiredDot() {
  return (
    <span
      role="img"
      aria-label="required"
      title="Required"
      className="inline-block size-1.5 shrink-0 self-center rounded-full bg-orange-500"
    />
  );
}
