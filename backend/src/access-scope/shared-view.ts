/** Primeiro nome, o unico dado de quem criou um item que o parceiro enxerga (contrato 11b, decisao 8). */
export function firstNameOf(name: string | null | undefined): string | null {
  const first = name?.trim().split(/\s+/)[0];
  return first ? first : null;
}

/** Campo interno de compartilhamento: fica fora de toda resposta e da exportacao (a resposta de hoje nao o tem). */
export function withoutSharingMark<T extends { sharedGroupOwnerId?: string | null }>(
  row: T,
): Omit<T, 'sharedGroupOwnerId'> {
  const { sharedGroupOwnerId: _sharingMark, ...rest } = row;
  return rest;
}

export function isSharedItem(row: { sharedGroupOwnerId?: string | null }): boolean {
  return Boolean(row.sharedGroupOwnerId);
}

export interface SharingFlags {
  isShared: boolean;
  isMine: boolean;
  sharedByName: string | null;
}

/** Item do proprio usuario em listagem de escopo (shared/all). */
export function ownSharingFlags(row: { sharedGroupOwnerId: string | null }): SharingFlags {
  return { isShared: isSharedItem(row), isMine: true, sharedByName: null };
}

/** Item de outro membro: sempre compartilhado (so chega aqui se estava visivel). */
export function partnerSharingFlags(authorFirstName: string | null): SharingFlags {
  return { isShared: true, isMine: false, sharedByName: authorFirstName };
}

/** Recibo do que foi gravado na marcacao de compartilhamento (contrato 11b, regra de escrita). */
export interface SharingReceipt {
  id: string;
  isShared: boolean;
  updatedAt: string;
}

export function toSharingReceipt(row: {
  id: string;
  sharedGroupOwnerId: string | null;
  updatedAt: Date;
}): SharingReceipt {
  return {
    id: row.id,
    isShared: isSharedItem(row),
    updatedAt: row.updatedAt.toISOString(),
  };
}
