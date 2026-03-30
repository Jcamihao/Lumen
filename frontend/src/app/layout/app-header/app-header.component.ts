import { CommonModule } from '@angular/common';
import { Component, ElementRef, EventEmitter, HostListener, Input, Output, inject } from '@angular/core';
import { AvatarComponent } from '../../shared/components/avatar/avatar.component';
import { UiButtonComponent } from '../../shared/components/ui-button/ui-button.component';

@Component({
  selector: 'app-app-header',
  standalone: true,
  imports: [CommonModule, AvatarComponent, UiButtonComponent],
  templateUrl: './app-header.component.html',
  styleUrls: ['./app-header.component.scss'],
})
export class AppHeaderComponent {
  private readonly host = inject(ElementRef<HTMLElement>);
  protected menuOpen = false;

  @Input() eyebrow = 'Lumen';
  @Input({ required: true }) title!: string;
  @Input() subtitle = '';
  @Input() actionLabel = 'Nova tarefa';
  @Input() userName = 'Você';
  @Input() userMeta = 'workspace pessoal';
  @Input() userAvatarUrl: string | null = null;
  @Input() themeMode: 'light' | 'dark' = 'light';
  @Input() isOffline = false;
  @Input() pendingSyncCount = 0;
  @Input() syncing = false;

  @Output() readonly toggleTheme = new EventEmitter<void>();
  @Output() readonly quickAction = new EventEmitter<void>();
  @Output() readonly openSettings = new EventEmitter<void>();
  @Output() readonly logout = new EventEmitter<void>();

  @HostListener('document:click', ['$event'])
  protected onDocumentClick(event: MouseEvent) {
    if (!this.host.nativeElement.contains(event.target as Node)) {
      this.menuOpen = false;
    }
  }

  protected toggleMenu(event: MouseEvent) {
    event.stopPropagation();
    this.menuOpen = !this.menuOpen;
  }

  protected handleSettings() {
    this.menuOpen = false;
    this.openSettings.emit();
  }

  protected handleLogout() {
    this.menuOpen = false;
    this.logout.emit();
  }

  protected shortUserName() {
    const parts = this.userName
      .split(' ')
      .map((part) => part.trim())
      .filter(Boolean);

    return parts.slice(0, 2).join(' ') || this.userName;
  }
}
