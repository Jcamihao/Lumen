const byLinesDesc = (a, b) => b.lines - a.lines;

/** Seleciona o que passa dos limites configurados. */
export function findViolations(result, limits) {
  return {
    files: result.fileRows.filter((row) => row.lines > row.limit).sort(byLinesDesc),
    functionsFail: result.functions.filter((fn) => fn.lines > limits.failFunctionLines).sort(byLinesDesc),
    functionsWarn: result.functions
      .filter((fn) => fn.lines > limits.warnFunctionLines && fn.lines <= limits.failFunctionLines)
      .sort(byLinesDesc),
    classes: result.classes
      .filter((c) => c.methods > limits.maxClassMethods || c.ctorParams > limits.maxConstructorParams)
      .sort((a, b) => b.methods + b.ctorParams - (a.methods + a.ctorParams)),
  };
}

export function countViolations(violations) {
  return violations.files.length + violations.functionsFail.length + violations.classes.length;
}
