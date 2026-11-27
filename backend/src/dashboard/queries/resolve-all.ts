/** Espera as consultas do objeto em paralelo (Promise.all) e devolve os resultados com as mesmas chaves. */
export async function resolveAll<T extends object>(pending: { [K in keyof T]: Promise<T[K]> }): Promise<T> {
  const keys = Object.keys(pending) as Array<keyof T>;
  const results = await Promise.all(keys.map((key) => pending[key]));
  return Object.fromEntries(keys.map((key, index) => [key, results[index]])) as T;
}
