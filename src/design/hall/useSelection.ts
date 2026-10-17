import { useState } from "react";

/** The one selected piece id, shared by the list, the scene and the inspector. A click on the selected piece clears it,
    and an id that left the scene is no selection. */
export function useSelection(ids: readonly string[]) {
  const [picked, setPicked] = useState<string>();
  const selected = picked !== undefined && ids.includes(picked) ? picked : undefined;
  return { selected, toggle: (id: string) => setPicked(selected === id ? undefined : id) };
}
