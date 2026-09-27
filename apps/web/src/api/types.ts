export type JsonResponse<T> =
  T extends Date ? string
    : T extends readonly (infer Item)[] ? JsonResponse<Item>[]
      : T extends object ? { [Key in keyof T]: JsonResponse<T[Key]> }
        : T;
