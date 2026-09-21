import { Routes } from '@angular/router';
import { guestGuard, authGuard } from './core/guards/auth.guard';

export const routes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    canActivate: [guestGuard],
    loadComponent: () =>
      import('./features/landing/landing-page/landing-page.component').then(
        (module) => module.LandingPageComponent,
      ),
  },
  {
    path: 'login',
    pathMatch: 'full',
    redirectTo: 'auth/login',
  },
  {
    path: 'signup',
    pathMatch: 'full',
    redirectTo: 'auth/register',
  },
  {
    path: 'auth/login',
    canActivate: [guestGuard],
    loadComponent: () =>
      import('./features/auth/login-page/login-page.component').then(
        (module) => module.LoginPageComponent,
      ),
  },
  {
    path: 'auth/register',
    canActivate: [guestGuard],
    loadComponent: () =>
      import('./features/auth/register-page/register-page.component').then(
        (module) => module.RegisterPageComponent,
      ),
  },
  {
    path: 'auth/forgot-password',
    canActivate: [guestGuard],
    loadComponent: () =>
      import('./features/auth/forgot-password-page/forgot-password-page.component').then(
        (module) => module.ForgotPasswordPageComponent,
      ),
  },
  // Sem guard de proposito: quem abre o link do email pode estar logado, e o
  // guestGuard o mandaria pro dashboard sem mostrar a pagina.
  {
    path: 'auth/reset-password',
    loadComponent: () =>
      import('./features/auth/reset-password-page/reset-password-page.component').then(
        (module) => module.ResetPasswordPageComponent,
      ),
  },
  {
    path: 'auth/verify-email',
    loadComponent: () =>
      import('./features/auth/verify-email-page/verify-email-page.component').then(
        (module) => module.VerifyEmailPageComponent,
      ),
  },
  {
    path: 'unsubscribe',
    loadComponent: () =>
      import('./features/auth/unsubscribe-page/unsubscribe-page.component').then(
        (module) => module.UnsubscribePageComponent,
      ),
  },
  // Publica, sem guard: e um material de divulgacao (cartaz com QR code) que o
  // publicitario abre sem conta, logado ou nao.
  {
    path: 'qr',
    loadComponent: () =>
      import('./features/qr/qr-page/qr-page.component').then(
        (module) => module.QrPageComponent,
      ),
  },
  {
    path: '',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./layout/workspace-shell/workspace-shell.component').then(
        (module) => module.WorkspaceShellComponent,
      ),
    children: [
      {
        path: 'dashboard',
        loadComponent: () =>
          import('./features/dashboard/dashboard-page/dashboard-page.component').then(
            (module) => module.DashboardPageComponent,
          ),
      },
      {
        path: 'inicio',
        pathMatch: 'full',
        redirectTo: 'dashboard',
      },
      {
        path: 'tasks',
        loadComponent: () =>
          import('./features/tasks/tasks-page/tasks-page.component').then(
            (module) => module.TasksPageComponent,
          ),
      },
      {
        path: 'finance',
        loadComponent: () =>
          import('./features/finances/finances-page/finances-page.component').then(
            (module) => module.FinancesPageComponent,
          ),
      },
      {
        path: 'finances',
        loadComponent: () =>
          import('./features/finances/finances-page/finances-page.component').then(
            (module) => module.FinancesPageComponent,
          ),
      },
      {
        path: 'goals',
        loadComponent: () =>
          import('./features/goals/goals-page/goals-page.component').then(
            (module) => module.GoalsPageComponent,
          ),
      },
      {
        path: 'assistant',
        loadComponent: () =>
          import('./features/assistant/assistant-page/assistant-page.component').then(
            (module) => module.AssistantPageComponent,
          ),
      },
      {
        path: 'selah',
        pathMatch: 'full',
        redirectTo: 'assistant',
      },
      {
        path: 'assistente',
        pathMatch: 'full',
        redirectTo: 'assistant',
      },
      {
        path: 'notifications',
        loadComponent: () =>
          import('./features/notifications/notifications-page/notifications-page.component').then(
            (module) => module.NotificationsPageComponent,
          ),
      },
      {
        path: 'alertas',
        pathMatch: 'full',
        redirectTo: 'notifications',
      },
      {
        path: 'imports',
        loadComponent: () =>
          import('./features/imports/imports-page/imports-page.component').then(
            (module) => module.ImportsPageComponent,
          ),
      },
      {
        path: 'importar',
        pathMatch: 'full',
        redirectTo: 'imports',
      },
      {
        path: 'settings',
        loadComponent: () =>
          import('./features/settings/settings-page/settings-page.component').then(
            (module) => module.SettingsPageComponent,
          ),
      },
      {
        path: 'support',
        loadComponent: () =>
          import('./features/support/support-page/support-page.component').then(
            (module) => module.SupportPageComponent,
          ),
      },
      {
        path: 'feedback',
        loadComponent: () =>
          import('./features/feedback/feedback-page/feedback-page.component').then(
            (module) => module.FeedbackPageComponent,
          ),
      },
      {
        path: 'ajuda',
        pathMatch: 'full',
        redirectTo: 'support',
      },
      {
        path: 'admin/support',
        loadComponent: () =>
          import('./features/admin/admin-support-page/admin-support-page.component').then(
            (module) => module.AdminSupportPageComponent,
          ),
      },
    ],
  },
  {
    path: '**',
    redirectTo: '',
  },
];
