const FUNCTION_KINDS = [
  'FunctionDeclaration',
  'MethodDeclaration',
  'FunctionExpression',
  'ArrowFunction',
  'Constructor',
  'GetAccessor',
  'SetAccessor',
];

function lineSpan(ts, sf, node) {
  const start = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line;
  const end = sf.getLineAndCharacterOfPosition(node.getEnd()).line;
  return { line: start + 1, lines: end - start + 1 };
}

function nameOf(ts, sf, node) {
  if (node.name) return node.name.getText(sf);
  if (ts.SyntaxKind[node.kind] === 'Constructor') return 'constructor';
  const parent = node.parent;
  if (parent && parent.name) return parent.name.getText(sf);
  return '(anonima)';
}

function isFunctionLike(ts, node) {
  return FUNCTION_KINDS.includes(ts.SyntaxKind[node.kind]) && node.body !== undefined;
}

function describeClass(ts, sf, node) {
  const members = node.members;
  const ctor = members.find((m) => ts.SyntaxKind[m.kind] === 'Constructor');
  return {
    name: node.name ? node.name.getText(sf) : '(anonima)',
    line: lineSpan(ts, sf, node).line,
    methods: members.filter((m) => ts.SyntaxKind[m.kind] === 'MethodDeclaration').length,
    ctorParams: ctor ? ctor.parameters.length : 0,
  };
}

/** Mede funcoes e classes de um arquivo .ts de producao. */
export function measureCode(ts, file) {
  const sf = ts.createSourceFile(file.path, file.source, ts.ScriptTarget.Latest, true);
  const functions = [];
  const classes = [];
  const visit = (node) => {
    if (isFunctionLike(ts, node)) {
      functions.push({ name: nameOf(ts, sf, node), ...lineSpan(ts, sf, node) });
    }
    if (ts.SyntaxKind[node.kind] === 'ClassDeclaration') classes.push(describeClass(ts, sf, node));
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return { functions, classes };
}
