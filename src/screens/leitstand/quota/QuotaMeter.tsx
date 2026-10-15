import type { QuotaView } from "./forecast";

/** Stub that compiles; the meter and the sentence follow in the next commit. */
export function QuotaMeter({ name }: { view: QuotaView; name: string }) {
  return <span>{name}</span>;
}
