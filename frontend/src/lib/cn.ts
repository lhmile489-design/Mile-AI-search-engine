// 拼接 className：跳过 false / null / undefined / 空串。
// 不引入 clsx 等依赖，组件里的条件类名够用。
export function cn(...parts: ReadonlyArray<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}
