export function formatCurrency(value: number, currencyCode: string) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: currencyCode }).format(value);
}
