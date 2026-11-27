import { TransactionType } from "@prisma/client";
import { DEFAULT_TAG_GROUPS } from "../../tag-groups/tag-groups.service";

const DEFAULT_TASK_CATEGORIES = [
  { name: "Pessoal", color: "#7c5cff", icon: "self_improvement" },
  { name: "Trabalho", color: "#0f9d7a", icon: "work" },
  { name: "Casa", color: "#f18f01", icon: "home" },
];

const DEFAULT_FINANCE_CATEGORIES = [
  { name: "Moradia", color: "#f97316", icon: "home", type: TransactionType.EXPENSE },
  { name: "Alimentacao", color: "#ef4444", icon: "restaurant", type: TransactionType.EXPENSE },
  { name: "Salario", color: "#10b981", icon: "payments", type: TransactionType.INCOME },
];

export function buildDefaultTaskCategories(userId: string) {
  return DEFAULT_TASK_CATEGORIES.map((category) => ({ userId, ...category }));
}

export function buildDefaultFinanceCategories(userId: string) {
  return DEFAULT_FINANCE_CATEGORIES.map((category) => ({ userId, ...category }));
}

export function buildDefaultTagGroups(userId: string) {
  return DEFAULT_TAG_GROUPS.map((group, index) => ({
    userId,
    name: group.name,
    color: group.color,
    isDefault: true,
    sortOrder: index,
  }));
}
