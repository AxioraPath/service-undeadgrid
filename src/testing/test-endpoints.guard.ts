import { CanActivate, Injectable, NotFoundException } from '@nestjs/common';

/** Enabled when ENABLE_TEST_ENDPOINTS=true, or NODE_ENV != production (unless explicitly "false"). */
export function testEndpointsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const flag = env.ENABLE_TEST_ENDPOINTS?.trim().toLowerCase();
  if (flag === 'true') return true;
  if (flag === 'false') return false;
  return env.NODE_ENV !== 'production';
}

@Injectable()
export class TestEndpointsGuard implements CanActivate {
  canActivate(): boolean {
    if (!testEndpointsEnabled()) throw new NotFoundException();
    return true;
  }
}
