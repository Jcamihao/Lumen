import { measureCode } from './measure-code.mjs';
import { moduleOf } from './module-of.mjs';

function fileLimit(file, limits) {
  return file.kind === 'spec' ? limits.maxSpecLines : limits.maxFileLines;
}

function toFileRow(file, limits) {
  return {
    path: file.path,
    kind: file.kind,
    module: moduleOf(file.path),
    lines: file.lines,
    limit: fileLimit(file, limits),
  };
}

function measureProductionTs(ts, file) {
  if (!ts || file.kind !== 'code') return { functions: [], classes: [] };
  return measureCode(ts, file);
}

function withOwner(items, file) {
  return items.map((item) => ({ ...item, path: file.path, module: moduleOf(file.path) }));
}

/** Junta tamanho de arquivo, funcoes e classes num unico resultado. */
export function analyze(files, limits, ts) {
  const fileRows = files.map((file) => toFileRow(file, limits));
  const functions = [];
  const classes = [];
  for (const file of files) {
    const measured = measureProductionTs(ts, file);
    functions.push(...withOwner(measured.functions, file));
    classes.push(...withOwner(measured.classes, file));
  }
  return { fileRows, functions, classes };
}
