export const ROOTS = ['backend/src', 'frontend/src'];
export const EXTENSIONS = ['.ts', '.html', '.scss'];
export const IGNORED_DIRS = ['node_modules', 'dist', '.angular', 'coverage'];

export const DEFAULT_LIMITS = {
  maxFileLines: 120,
  maxSpecLines: 120,
  warnFunctionLines: 20,
  failFunctionLines: 30,
  maxClassMethods: 12,
  maxConstructorParams: 6,
};

export const DEFAULT_OPTIONS = {
  top: 25,
  json: false,
  failOnViolation: false,
  modulePrefix: null,
};
