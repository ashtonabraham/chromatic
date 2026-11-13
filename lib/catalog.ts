// Artwork-type filters, shared by the API client and the UI chips.
export const TYPES = [
  { key: "all", label: "Everything", ids: null },
  { key: "painting", label: "Paintings", ids: [1, 30] },
  { key: "print", label: "Prints", ids: [18] },
  { key: "drawing", label: "Drawings", ids: [14] },
  { key: "photo", label: "Photographs", ids: [2] },
  { key: "textile", label: "Textiles", ids: [5, 12, 38] },
  { key: "object", label: "Objects", ids: [3, 8, 23, 35, 36, 37] },
] as const;

export type TypeKey = (typeof TYPES)[number]["key"];

export const isTypeKey = (v: unknown): v is TypeKey => TYPES.some((t) => t.key === v);
