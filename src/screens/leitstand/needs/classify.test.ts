import { describe, expect, it } from "vitest";

import { classifyQuestion } from "./classify";

describe("classifyQuestion", () => {
  it("ranks a money question above install and delete words", () => {
    expect(classifyQuestion("Darf ich das kaufen und npm install ausführen und die Datei löschen?")).toBe("money");
  });

  it("leaves a question about a test name unclassified", () => {
    expect(classifyQuestion("Wie soll der Test heißen?")).toBe("other");
  });

  it("ranks install above delete and matches case-insensitively", () => {
    expect(classifyQuestion("Run NPM INSTALL, then DELETE the cache?")).toBe("install");
    expect(classifyQuestion("Paket installieren?")).toBe("install");
  });

  it("finds delete words in both spellings", () => {
    expect(classifyQuestion("Datei löschen?")).toBe("delete");
    expect(classifyQuestion("Datei loeschen?")).toBe("delete");
    expect(classifyQuestion("May I delete the branch?")).toBe("delete");
  });

  it("finds each money word and ignores the too-broad ones", () => {
    for (const word of ["Geld", "kaufen", "bezahlen", "abrechnen", "credit", "invoice"]) {
      expect(classifyQuestion(`Frage zu ${word}?`)).toBe("money");
    }
    expect(classifyQuestion("Was kosten die Tokens? Soll ich den Ordner entfernen?")).toBe("other");
  });

  it("treats empty text as other", () => {
    expect(classifyQuestion("")).toBe("other");
  });
});
