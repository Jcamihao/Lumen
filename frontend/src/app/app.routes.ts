import { Routes } from '@angular/router';
import { guestGuard, authGuard } from './core/guards/auth.guard';

export const routes: Routes = [
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
        path: 'ajuda',
        pathMatch: 'full',
        redirectTo: 'support',
      },
      { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
    ],
  },
  {
    path: '**',
    redirectTo: '',
  },
];
