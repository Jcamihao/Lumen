import { DEFAULT_LIMITS, DEFAULT_OPTIONS } from './config.mjs';

const LIMIT_FLAGS = {
  '--file-max': 'maxFileLines',
  '--spec-max': 'maxSpecLines',
  '--fn-warn': 'warnFunctionLines',
  '--fn-fail': 'failFunctionLines',
  '--class-methods': 'maxClassMethods',
  '--ctor-params': 'maxConstructorParams',
};

function readNumber(flag, value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Valor invalido para ${flag}: "${value}"`);
  }
  return parsed;
}

function applyFlag(state, flag, value) {
  if (flag in LIMIT_FLAGS) state.limits[LIMIT_FLAGS[flag]] = readNumber(flag, value);
  else if (flag === '--top') state.options.top = readNumber(flag, value);
  else if (flag === '--module') state.options.modulePrefix = value;
  else if (flag === '--json') state.options.json = true;
  else if (flag === '--fail') state.options.failOnViolation = true;
  else throw new Error(`Opcao desconhecida: ${flag}`);
}

export function parseArgs(argv) {
  const state = { limits: { ...DEFAULT_LIMITS }, options: { ...DEFAULT_OPTIONS } };
  for (const arg of argv) {
    const [flag, value] = arg.split('=');
    applyFlag(state, flag, value);
  }
  return state;
}
