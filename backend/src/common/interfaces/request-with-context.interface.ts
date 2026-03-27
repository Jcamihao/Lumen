import { Request } from 'express';
import { AuthenticatedUser } from './authenticated-user.interface';

export interface RequestWithContext extends Request {
  requestId?: string;
  startedAt?: number;
  user?: AuthenticatedUser;
}
