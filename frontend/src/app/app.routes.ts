import { Routes } from '@angular/router';
import { guestGuard, authGuard } from './core/guards/auth.guard';
import { AssistantPageComponent } from './features/assistant/assistant-page.component';
import { DashboardPageComponent } from './features/dashboard/dashboard-page.component';
import { FinancesPageComponent } from './features/finances/finances-page.component';
import { ImportsPageComponent } from './features/imports/imports-page.component';
import { LoginPageComponent } from './features/auth/login-page.component';
import { RegisterPageComponent } from './features/auth/register-page.component';
import { GoalsPageComponent } from './features/goals/goals-page.component';
import { SettingsPageComponent } from './features/settings/settings-page.component';
import { TasksPageComponent } from './features/tasks/tasks-page.component';
import { WorkspaceShellComponent } from './layout/workspace-shell.component';

export const routes: Routes = [
  {
    path: 'auth/login',
    canActivate: [guestGuard],
    component: LoginPageComponent,
  },
  {
    path: 'auth/register',
    canActivate: [guestGuard],
    component: RegisterPageComponent,
  },
  {
    path: '',
    canActivate: [authGuard],
    component: WorkspaceShellComponent,
    children: [
      { path: 'dashboard', component: DashboardPageComponent },
      { path: 'tasks', component: TasksPageComponent },
      { path: 'finances', component: FinancesPageComponent },
      { path: 'goals', component: GoalsPageComponent },
      { path: 'assistant', component: AssistantPageComponent },
      { path: 'imports', component: ImportsPageComponent },
      { path: 'settings', component: SettingsPageComponent },
      { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
    ],
  },
  {
    path: '**',
    redirectTo: '',
  },
];
