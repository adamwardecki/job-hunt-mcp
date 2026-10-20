// JSON Schema builders for tool inputs. Each builder returns plain JSON Schema at runtime and carries
// the TypeScript type of the value in a phantom `__t` property that never exists on the object, so
// ArgsOf<typeof schema> gives a handler's argument type from the same declaration tools/list sends.

export interface Prop<T> {
  type: string;
  description: string;
  readonly __t?: T;
  [extra: string]: unknown;
}
export type Props = Record<string, Prop<unknown>>;

export interface ObjSchema<P extends Props, R extends keyof P> {
  type: 'object';
  properties: P;
  required: R[];
  additionalProperties: false;
}

type TypeOf<X> = X extends Prop<infer T> ? T : never;
type Simplify<T> = { [K in keyof T]: T[K] } & {};

// Required keys keep their type. Optional keys may also be null: checkArgs lets null through for them.
export type ArgsOf<S> = S extends ObjSchema<infer P, infer R>
  ? Simplify<{ [K in R]: TypeOf<P[K]> } & { [K in Exclude<keyof P, R>]?: TypeOf<P[K]> | null }>
  : never;

const S = <T>(type: string, description: string, extra: Record<string, unknown> = {}): Prop<T> => ({ type, description, ...extra });
export const str = (d: string) => S<string>('string', d);
export const int = (d: string) => S<number>('integer', d);
export const num = (d: string) => S<number>('number', d);
export const bool = (d: string) => S<boolean>('boolean', d);
export const strList = (d: string) => S<string[]>('array', d, { items: { type: 'string' } });
// Free-form objects and arrays: T is what the handler may assume after checkArgs' top-level type check.
export const typed = <T>(type: 'object' | 'array', d: string, extra?: Record<string, unknown>) => S<T>(type, d, extra);
export const obj = <P extends Props, const R extends keyof P = never>(properties: P, required: R[] = []): ObjSchema<P, R> => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false,
});
