export function DevNote({ children, className }: { children: string; className?: string }) {
  return <p className={className}>{children}</p>;
}
