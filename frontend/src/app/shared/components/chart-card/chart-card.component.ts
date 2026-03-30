import { CommonModule, NgClass } from '@angular/common';
import { Component, Input } from '@angular/core';
import { PanelComponent } from '../panel/panel.component';
import { UiBadgeComponent } from '../ui-badge/ui-badge.component';

export type ChartTone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'dark';

export type ChartSignal = {
  label: string;
  value: string;
  detail: string;
  tone?: ChartTone;
};

type ChartSlice = {
  color: string;
  dashArray: string;
  dashOffset: number;
  label: string;
  share: number;
  shareLabel: string;
  value: number;
  valueLabel: string;
};

@Component({
  selector: 'app-chart-card',
  standalone: true,
  imports: [CommonModule, NgClass, PanelComponent, UiBadgeComponent],
  templateUrl: './chart-card.component.html',
  styleUrls: ['./chart-card.component.scss'],
})
export class ChartCardComponent {
  private readonly fallbackSeries = [42, 48, 54, 62, 59, 51, 46];
  private readonly donutColors = ['#6366f1', '#818cf8', '#4f46e5', '#a78bfa', '#38bdf8', '#f59e0b', '#10b981'];
  private readonly donutCircumference = 2 * Math.PI * 74;
  private readonly segmentGap = 6;

  protected hoveredSlice: number | null = null;
  protected selectedSlice: number | null = null;

  @Input({ required: true }) title!: string;
  @Input() caption = '';
  @Input() value = '';
  @Input() helper = '';
  @Input() delta = '';
  @Input() deltaTone: ChartTone = 'accent';
  @Input() data: number[] = [];
  @Input() labels: string[] = [];
  @Input() currencyCode = 'BRL';
  @Input() signals: ChartSignal[] = [];

  protected slices(): ChartSlice[] {
    const series = this.safeSeries().map((value) => Math.abs(Number(value || 0)));
    const labels = this.safeLabels();
    const total = series.reduce((sum, value) => sum + value, 0) || 1;
    let offset = 0;

    return series.map((value, index) => {
      const share = (value / total) * 100;
      const segmentLength = Math.max((this.donutCircumference * share) / 100 - this.segmentGap, 0);
      const slice: ChartSlice = {
        color: this.donutColors[index % this.donutColors.length],
        dashArray: `${segmentLength} ${this.donutCircumference}`,
        dashOffset: -offset,
        label: labels[index] || `Item ${index + 1}`,
        share,
        shareLabel: `${share.toFixed(0)}%`,
        value,
        valueLabel: this.formatCompact(value),
      };

      offset += (this.donutCircumference * share) / 100;
      return slice;
    });
  }

  protected activeSliceIndex() {
    const slices = this.slices();

    if (!slices.length) {
      return 0;
    }

    if (this.hoveredSlice !== null && this.hoveredSlice < slices.length) {
      return this.hoveredSlice;
    }

    if (this.selectedSlice !== null && this.selectedSlice < slices.length) {
      return this.selectedSlice;
    }

    return this.dominantSliceIndex();
  }

  protected activeSlice() {
    return this.slices()[this.activeSliceIndex()] || null;
  }

  protected activeSliceLabel() {
    return this.activeSlice()?.label || 'Sem leitura';
  }

  protected activeSliceShare() {
    const active = this.activeSlice();
    return active ? `${active.shareLabel} do total` : '0%';
  }

  protected activeSliceKicker() {
    return this.activeSliceIndex() === this.dominantSliceIndex()
      ? 'Maior fatia'
      : 'Fatia ativa';
  }

  protected distributionLabel() {
    const dominant = this.slices()[this.dominantSliceIndex()];

    if (!dominant) {
      return 'Sem leitura';
    }

    if (dominant.share >= 32) {
      return 'Concentrada';
    }

    if (dominant.share >= 22) {
      return 'Balanceada';
    }

    return 'Pulverizada';
  }

  protected onHoverSlice(index: number) {
    this.hoveredSlice = index;
  }

  protected clearHoveredSlice() {
    this.hoveredSlice = null;
  }

  protected selectSlice(index: number) {
    this.selectedSlice = index;
  }

  protected sliceAriaLabel(slice: ChartSlice) {
    return `${slice.label}: ${slice.shareLabel}, ${slice.valueLabel}`;
  }

  protected safeSignals() {
    return this.signals.slice(0, 3);
  }

  protected trackSlice(index: number) {
    return index;
  }

  protected trackSignal(index: number) {
    return index;
  }

  private dominantSliceIndex() {
    const slices = this.slices();

    if (!slices.length) {
      return 0;
    }

    return slices.reduce((current, slice, index, all) =>
      slice.share > all[current].share ? index : current, 0);
  }

  private safeSeries() {
    return this.data.length >= 2 ? this.data : this.fallbackSeries;
  }

  private safeLabels() {
    return this.labels.length === this.safeSeries().length
      ? this.labels
      : ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];
  }

  private formatCompact(value: number) {
    const normalized = Number(value || 0);
    const sign = normalized < 0 ? '-' : '';
    const abs = Math.abs(normalized);
    const compact = new Intl.NumberFormat('pt-BR', {
      notation: 'compact',
      maximumFractionDigits: abs >= 1000 ? 1 : 0,
    }).format(abs);

    return `${sign}${this.currencySymbol()} ${compact}`;
  }

  private currencySymbol() {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: this.currencyCode,
      currencyDisplay: 'symbol',
      maximumFractionDigits: 0,
      minimumFractionDigits: 0,
    })
      .formatToParts(0)
      .find((part) => part.type === 'currency')
      ?.value || this.currencyCode;
  }
}
