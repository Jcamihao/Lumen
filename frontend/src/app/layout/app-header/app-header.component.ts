import { CommonModule } from '@angular/common';
import { Component, ElementRef, EventEmitter, HostListener, Input, Output, inject } from '@angular/core';
import { NotificationCenterEntry } from '../../core/models/domain.models';
import { AvatarComponent } from '../../shared/components/avatar/avatar.component';
import { UiBadgeComponent } from '../../shared/components/ui-badge/ui-badge.component';
import { UiButtonComponent } from '../../shared/components/ui-button/ui-button.component';

@Component({
  selector: 'app-app-header',
  standalone: true,
  imports: [CommonModule, AvatarComponent, UiBadgeComponent, UiButtonComponent],
  templateUrl: './app-header.component.html',
  styleUrls: ['./app-header.component.scss'],
})
export class AppHeaderComponent {
  private readonly host = inject(ElementRef<HTMLElement>);
  protected menuOpen = false;
  protected notificationsOpen = false;

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
  @Input() notificationEntries: NotificationCenterEntry[] = [];
  @Input() unreadNotificationsCount = 0;
  @Input() notificationsLoading = false;

  @Output() readonly toggleTheme = new EventEmitter<void>();
  @Output() readonly quickAction = new EventEmitter<void>();
  @Output() readonly openNotifications = new EventEmitter<void>();
  @Output() readonly markNotificationRead = new EventEmitter<string>();
  @Output() readonly openSettings = new EventEmitter<void>();
  @Output() readonly logout = new EventEmitter<void>();

  @HostListener('document:click', ['$event'])
  protected onDocumentClick(event: MouseEvent) {
    if (!this.host.nativeElement.contains(event.target as Node)) {
      this.menuOpen = false;
      this.notificationsOpen = false;
    }
  }

  protected toggleNotifications(event: MouseEvent) {
    event.stopPropagation();
    this.menuOpen = false;
    this.notificationsOpen = !this.notificationsOpen;
  }

  protected toggleMenu(event: MouseEvent) {
    event.stopPropagation();
    this.notificationsOpen = false;
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

  protected handleNotificationEntry(entry: NotificationCenterEntry) {
    if (entry.kind === 'notification' && !entry.isRead) {
      this.markNotificationRead.emit(entry.id);
    }
  }

  protected handleOpenNotifications() {
    this.notificationsOpen = false;
    this.openNotifications.emit();
  }

  protected notificationTone(entry: NotificationCenterEntry) {
    return entry.kind === 'reminder' ? 'success' : entry.isRead ? 'neutral' : 'accent';
  }

  protected notificationLabel(entry: NotificationCenterEntry) {
    return entry.kind === 'reminder' ? 'Lembrete' : entry.isRead ? 'Lida' : 'Nova';
  }

  protected shortUserName() {
    const parts = this.userName
      .split(' ')
      .map((part) => part.trim())
      .filter(Boolean);

    return parts.slice(0, 2).join(' ') || this.userName;
  }
}
