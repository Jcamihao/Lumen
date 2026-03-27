import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  getIndex() {
    return {
      name: 'LUMEN API',
      slogan: 'Clareza para sua vida',
      company: 'codeStage Solucoes',
      version: '1.0.0',
    };
  }

  getHealth() {
    return {
      status: 'ok',
      service: 'lumen-backend',
      timestamp: new Date().toISOString(),
    };
  }
}
