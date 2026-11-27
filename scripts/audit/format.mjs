export const pad = (value, size) => String(value).padStart(size);

export function section(title, rows, top, renderRow) {
  const lines = [`\n== ${title} (${rows.length})`];
  if (rows.length === 0) return [...lines, '  nenhum'].join('\n');
  rows.slice(0, top).forEach((row) => lines.push(renderRow(row)));
  if (rows.length > top) lines.push(`  ... e mais ${rows.length - top} (use --top=N para ver mais)`);
  return lines.join('\n');
}

export const fileRow = (row) => `  ${pad(row.lines, 5)} / ${pad(row.limit, 3)}  ${row.path}`;

export const functionRow = (fn) => `  ${pad(fn.lines, 4)} linhas  ${fn.name}  ${fn.path}:${fn.line}`;

export const classRow = (c) =>
  `  ${pad(c.methods, 3)} metodos, ${c.ctorParams} deps  ${c.name}  ${c.path}:${c.line}`;

export const moduleRow = ([name, stats]) =>
  `  ${pad(stats.over, 4)} acima de ${pad(stats.total, 4)} arquivos  ${name}`;
