/**
 * Brand wordmark. The SVG is white + gold, so it is meant for dark/teal surfaces —
 * `BrandMark` wraps it in a teal tile for use on light backgrounds (admin portal).
 */
export function BrandLogo({ className = 'h-9 w-auto' }: { className?: string }) {
  return <img src="/pampers-logo.svg" alt="Pampers Club" className={className} draggable={false} />;
}

export function BrandMark({
  className = 'h-10',
  logoClassName = 'h-5 w-auto',
}: {
  className?: string;
  logoClassName?: string;
}) {
  return (
    <span
      className={`brand-gradient inline-flex items-center justify-center rounded-xl px-3 ${className}`}
    >
      <BrandLogo className={logoClassName} />
    </span>
  );
}
