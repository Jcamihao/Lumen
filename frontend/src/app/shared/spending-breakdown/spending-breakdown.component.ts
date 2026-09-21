import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, Input, OnChanges } from '@angular/core';
import { SpendingBreakdown } from '../../core/utils/spending.utils';

type DonutArc = {
  key: string;
  color: string;
  dash: string;
  offset: number;
};

// r = 100 / (2*pi): a circunferencia vale exatamente 100, entao a % de cada
// fatia vira direto o comprimento do arco.
const DONUT_RADIUS = 15.9155;
const SLICE_GAP = 0.6;

@Component({
  selector: 'app-spending-breakdown',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './spending-breakdown.component.html',
  styleUrls: ['./spending-breakdown.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SpendingBreakdownComponent implements OnChanges {
  protected readonly radius = DONUT_RADIUS;
  protected arcs: DonutArc[] = [];
  protected visibleSlices: SpendingBreakdown['slices'] = [];
  protected ariaLabel = '';

  @Input({ required: true }) currency = 'BRL';
  /** Versao enxuta (cartao do dashboard): rosca menor e poucas linhas. */
  @Input() compact = false;
  @Input() maxRows = 0;
  @Input() caption = 'gastos no mês';

  @Input({ required: true }) breakdown: SpendingBreakdown = { total: 0, slices: [] };

  // Recalcula a cada mudanca de input: a ordem em que o Angular aplica os
  // inputs nao e garantida, entao maxRows pode chegar depois de breakdown.
  ngOnChanges() {
    this.rebuild();
  }

  protected trackArc(_index: number, arc: DonutArc) {
    return arc.key;
  }

  protected trackSlice(_index: number, slice: SpendingBreakdown['slices'][number]) {
    return slice.key;
  }

  protected get total() {
    return this.breakdown.total;
  }

  private rebuild() {
    let cursor = 0;

    this.arcs = this.breakdown.slices.map((slice) => {
      const length = Math.max(slice.percent - (this.breakdown.slices.length > 1 ? SLICE_GAP : 0), 0.4);
      const arc: DonutArc = {
        key: slice.key,
        color: slice.color,
        dash: `${length} ${100 - length}`,
        // Comeca no topo (12h) e segue no sentido horario.
        offset: 25 - cursor,
      };
      cursor += slice.percent;
      return arc;
    });

    this.visibleSlices =
      this.maxRows > 0 ? this.breakdown.slices.slice(0, this.maxRows) : this.breakdown.slices;
    this.ariaLabel = this.breakdown.slices
      .map((slice) => `${slice.name} ${slice.percentLabel}%`)
      .join(', ');
  }
}
