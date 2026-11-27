export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] || "voce";
}

/** Nome para a saudacao; sem nome, "voce". */
export function greetingName(name?: string | null): string {
  return name ? firstName(name) : "voce";
}

export function formatDateTime(date: Date, timeZone?: string | null): string {
  try {
    return new Intl.DateTimeFormat("pt-BR", {
      dateStyle: "full",
      timeStyle: "short",
      timeZone: timeZone || "America/Sao_Paulo",
    }).format(date);
  } catch (error) {
    return date.toISOString();
  }
}

/** Valor em moeda pt-BR; moeda invalida cai para 2 casas simples. */
export function formatMoney(value: number, currency: string): string {
  try {
    return new Intl.NumberFormat("pt-BR", { style: "currency", currency: currency || "BRL" }).format(value);
  } catch {
    return value.toFixed(2);
  }
}
