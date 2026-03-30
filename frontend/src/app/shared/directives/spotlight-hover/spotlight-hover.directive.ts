import { Directive, ElementRef, HostListener, inject } from '@angular/core';

@Directive({
  selector: '[appSpotlightHover]',
  standalone: true,
})
export class SpotlightHoverDirective {
  private readonly host = inject(ElementRef<HTMLElement>);

  @HostListener('pointermove', ['$event'])
  protected onPointerMove(event: PointerEvent) {
    const element = this.host.nativeElement;
    const rect = element.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;

    element.style.setProperty('--spotlight-x', `${x}px`);
    element.style.setProperty('--spotlight-y', `${y}px`);
  }

  @HostListener('pointerleave')
  protected onPointerLeave() {
    const element = this.host.nativeElement;
    element.style.removeProperty('--spotlight-x');
    element.style.removeProperty('--spotlight-y');
  }
}
