/** Leva o usuario ao campo do formulario da propria pagina (botao "criar primeira ..." dos estados vazios). */
export function focusField(id: string) {
  const field = document.getElementById(id);

  if (!field) {
    return;
  }

  const reduceMotion =
    typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

  field.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'center' });
  field.focus({ preventScroll: true });
}
