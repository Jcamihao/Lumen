import { classRow, fileRow, functionRow, moduleRow, section } from './format.mjs';

function moduleStats(fileRows) {
  const stats = new Map();
  for (const row of fileRows) {
    const current = stats.get(row.module) ?? { over: 0, total: 0 };
    current.total += 1;
    if (row.lines > row.limit) current.over += 1;
    stats.set(row.module, current);
  }
  return [...stats.entries()].filter(([, s]) => s.over > 0).sort((a, b) => b[1].over - a[1].over);
}

function summaryLine(label, rows) {
  const over = rows.filter((row) => row.lines > row.limit).length;
  return `  ${label}: ${over} de ${rows.length} acima do limite`;
}

function summary(result, limits, tsAvailable) {
  const byKind = (kind) => result.fileRows.filter((row) => row.kind === kind);
  const lines = [
    `Limites: arquivo ${limits.maxFileLines}, spec ${limits.maxSpecLines}, funcao ${limits.warnFunctionLines}/${limits.failFunctionLines}`,
    summaryLine('codigo   ', byKind('code')),
    summaryLine('specs    ', byKind('spec')),
    summaryLine('templates', byKind('template')),
    summaryLine('estilos  ', byKind('style')),
  ];
  if (!tsAvailable) lines.push('  AVISO: TypeScript nao encontrado; funcoes e classes nao foram medidas.');
  return lines.join('\n');
}

export function renderReport({ result, violations, limits, top, tsAvailable }) {
  return [
    summary(result, limits, tsAvailable),
    section('Modulos com mais arquivos acima do limite', moduleStats(result.fileRows), top, moduleRow),
    section('Arquivos acima do limite', violations.files, top, fileRow),
    section(`Funcoes acima de ${limits.failFunctionLines} linhas`, violations.functionsFail, top, functionRow),
    section(`Funcoes entre ${limits.warnFunctionLines} e ${limits.failFunctionLines} linhas`, violations.functionsWarn, top, functionRow),
    section('Classes com muitos metodos ou dependencias', violations.classes, top, classRow),
  ].join('\n');
}
