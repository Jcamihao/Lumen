import { toNullableNumber } from './number';
import { DashboardSummary } from './dashboard-summary.type';
import { SummarySources } from './summary-sources.type';

type TodayTask = SummarySources['todayTasks']['items'][number];

const mapTask = (task: TodayTask) => ({ ...task, estimatedAmount: toNullableNumber(task.estimatedAmount) });

export function mapTasks(sources: Pick<SummarySources, 'todayTasks' | 'overdueTasksCount'>): DashboardSummary['tasks'] {
  return {
    todayCount: sources.todayTasks.count,
    overdueCount: sources.overdueTasksCount,
    items: sources.todayTasks.items.map(mapTask),
  };
}
