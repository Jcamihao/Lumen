import { CommonModule } from '@angular/common';
import { AfterViewInit, ChangeDetectionStrategy, Component, ElementRef, ViewChild } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-landing-page',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './landing-page.component.html',
  styleUrls: ['./landing-page.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LandingPageComponent implements AfterViewInit {
  @ViewChild('bgVideo') private readonly bgVideoRef?: ElementRef<HTMLVideoElement>;

  ngAfterViewInit() {
    const video = this.bgVideoRef?.nativeElement;
    if (!video) return;

    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (prefersReducedMotion) {
      video.pause();
      return;
    }

    // Reforça o autoplay via JS — o atributo sozinho pode não disparar em
    // alguns navegadores/ambientes mesmo com muted+playsinline presentes.
    video.muted = true;
    video.play().catch(() => {
      // Autoplay bloqueado pelo navegador; sem controles visíveis não há
      // ação manual possível, mas o resto da página continua funcional.
    });
  }

  // Scroll manual em vez de depender do href="#id" nativo: dentro do SPA o
  // Router não tem anchorScrolling habilitado, então o navegador nem sempre
  // rola pra âncora de forma confiável.
  protected scrollToSection(event: Event, sectionId: string): void {
    event.preventDefault();
    document.getElementById(sectionId)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}
