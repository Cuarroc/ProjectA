export type QuestionClass = "money" | "install" | "delete" | "other";

export function classifyQuestion(_text: string): QuestionClass {
  return "other";
}
