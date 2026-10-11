import { useIsDevBuild } from "../../dev/useIsDevBuild";

/** Internal planning notes belong only to the ProjectA Dev channel. */
export function DevNote({ children, className }: { children: string; className?: string }) {
  const isDevBuild = useIsDevBuild();
  return isDevBuild ? <p className={className}>{children}</p> : null;
}
