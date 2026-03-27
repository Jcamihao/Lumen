import http from 'node:http';
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const currentDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(currentDir, '..');
const selahRoot = resolve(projectRoot, '../SelahIA');
const port = Number(process.env.SELAH_PORT || 3010);
const healthUrl = `http://127.0.0.1:${port}/health`;

checkExistingSelah()
  .then((isRunning) => {
    if (isRunning) {
      console.log(`SelahIA already running on port ${port}. Reusing existing instance.`);
      process.exit(0);
    }

    startSelah();
  })
  .catch((error) => {
    console.error('Unable to verify SelahIA status:', error);
    process.exit(1);
  });

function checkExistingSelah() {
  return new Promise((resolvePromise, rejectPromise) => {
    const request = http.get(healthUrl, (response) => {
      let body = '';

      response.setEncoding('utf8');
      response.on('data', (chunk) => {
        body += chunk;
      });
      response.on('end', () => {
        if ((response.statusCode || 500) >= 400) {
          resolvePromise(false);
          return;
        }

        try {
          const payload = JSON.parse(body);
          const service = String(payload.service || '').toLowerCase();
          const status = String(payload.status || '').toLowerCase();

          if (status === 'ok' && service.includes('selah')) {
            resolvePromise(true);
            return;
          }

          console.error(
            `Port ${port} is responding, but it does not look like SelahIA: ${body}`,
          );
          rejectPromise(new Error(`Port ${port} is already in use by another service.`));
        } catch {
          console.error(
            `Port ${port} is responding, but health payload is not valid JSON: ${body}`,
          );
          rejectPromise(new Error(`Port ${port} is already in use by another service.`));
        }
      });
    });

    request.setTimeout(1500, () => {
      request.destroy(new Error('Healthcheck timeout'));
    });

    request.on('error', (error) => {
      const transientErrors = new Set([
        'ECONNREFUSED',
        'ECONNRESET',
        'ETIMEDOUT',
        'EHOSTUNREACH',
      ]);

      if (transientErrors.has(String(error.code || ''))) {
        resolvePromise(false);
        return;
      }

      rejectPromise(error);
    });
  });
}

function startSelah() {
  const child = spawn('npm', ['--prefix', selahRoot, 'run', 'start:dev'], {
    stdio: 'inherit',
    env: process.env,
  });

  child.on('exit', (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }

    process.exit(code ?? 0);
  });

  child.on('error', (error) => {
    console.error('Failed to start SelahIA:', error);
    process.exit(1);
  });
}
