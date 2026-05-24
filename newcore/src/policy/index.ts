// ═══════════════════════════════════════════════════════════════
// OpenGravity — Policy & Safety Engine
// Controls what agents can and cannot do. Default-deny for
// destructive operations.
// ═══════════════════════════════════════════════════════════════

import { resolve, relative, isAbsolute } from 'path';
import type { PolicyChecker, PolicyAction, PolicyDecision } from '../types/index.js';
import { getConfig } from '../config/index.js';

// Dangerous commands that should never be run
const BLOCKED_COMMANDS = [
  'rm -rf /', 'rm -rf ~', 'del /f /s /q C:\\',
  'format ', 'mkfs', 'dd if=', ':(){:|:&};:',
  'shutdown', 'reboot', 'halt', 'poweroff',
  'reg delete', 'Remove-Item -Recurse -Force C:',
  'DROP DATABASE', 'DROP TABLE', 'TRUNCATE TABLE',
  '> /dev/sda', 'chmod -R 777 /',
];

// File paths that should never be written to
const PROTECTED_PATHS = [
  '/etc/', '/usr/', '/bin/', '/sbin/', '/boot/',
  'C:\\Windows\\', 'C:\\Program Files\\',
  '/System/', '/Library/',
];

export class PolicyEngine implements PolicyChecker {
  check(action: PolicyAction): PolicyDecision {
    switch (action.type) {
      case 'file_read':
        return this.checkFileRead(action);
      case 'file_write':
        return this.checkFileWrite(action);
      case 'file_delete':
        return this.checkFileDelete(action);
      case 'command_exec':
        return this.checkCommandExec(action);
      case 'network':
        return this.checkNetwork(action);
      case 'install_package':
        return this.checkInstallPackage(action);
      default:
        return { allowed: false, reason: `Unknown action type: ${action.type}` };
    }
  }

  private checkFileRead(action: PolicyAction): PolicyDecision {
    // Reading is generally safe, but block sensitive system files
    const target = action.target.toLowerCase();
    if (target.includes('.env') && !this.isWithinWorkspace(action.target, action.workspaceDir)) {
      return { allowed: false, reason: 'Cannot read .env files outside workspace' };
    }
    if (target.includes('/etc/shadow') || target.includes('/etc/passwd')) {
      return { allowed: false, reason: 'Cannot read system authentication files' };
    }
    return { allowed: true, reason: 'File read permitted' };
  }

  private checkFileWrite(action: PolicyAction): PolicyDecision {
    // Must be within workspace
    if (!this.isWithinWorkspace(action.target, action.workspaceDir)) {
      return { allowed: false, reason: `Cannot write outside workspace: ${action.target}` };
    }

    // Check protected paths
    for (const p of PROTECTED_PATHS) {
      if (action.target.startsWith(p)) {
        return { allowed: false, reason: `Protected system path: ${p}` };
      }
    }

    // Check file size limit
    const config = getConfig();
    // (Size check would be on the content, handled by the tool itself)

    return { allowed: true, reason: 'File write permitted within workspace' };
  }

  private checkFileDelete(action: PolicyAction): PolicyDecision {
    if (!this.isWithinWorkspace(action.target, action.workspaceDir)) {
      return { allowed: false, reason: 'Cannot delete files outside workspace' };
    }
    return { allowed: true, reason: 'File delete permitted within workspace', requiresApproval: true };
  }

  private checkCommandExec(action: PolicyAction): PolicyDecision {
    const cmd = action.target.toLowerCase();

    // Check blocked commands
    for (const blocked of BLOCKED_COMMANDS) {
      if (cmd.includes(blocked.toLowerCase())) {
        return { allowed: false, reason: `Blocked dangerous command: ${blocked}` };
      }
    }

    // Check for sudo/admin
    if (cmd.startsWith('sudo ') || cmd.includes('Run-As-Administrator')) {
      return { allowed: false, reason: 'Elevated privilege commands are blocked' };
    }

    // Check for package installation
    const config = getConfig();
    if (!config.allowSystemPackages) {
      const installCmds = ['apt install', 'apt-get install', 'yum install', 'brew install', 'choco install', 'pip install -g'];
      for (const installCmd of installCmds) {
        if (cmd.includes(installCmd)) {
          return { allowed: false, reason: 'System package installation is disabled. Set ALLOW_SYSTEM_PACKAGES=true to enable.' };
        }
      }
    }

    // npm install within workspace is OK
    if (cmd.includes('npm install') || cmd.includes('yarn add') || cmd.includes('pnpm add')) {
      return { allowed: true, reason: 'Package manager install within workspace is allowed' };
    }

    return { allowed: true, reason: 'Command execution permitted' };
  }

  private checkNetwork(action: PolicyAction): PolicyDecision {
    const config = getConfig();
    if (!config.allowNetworkRequests) {
      return { allowed: false, reason: 'Network requests are disabled. Set ALLOW_NETWORK_REQUESTS=true to enable.' };
    }
    return { allowed: true, reason: 'Network request permitted' };
  }

  private checkInstallPackage(action: PolicyAction): PolicyDecision {
    const config = getConfig();
    if (!config.allowSystemPackages) {
      return { allowed: false, reason: 'Package installation is disabled' };
    }
    return { allowed: true, reason: 'Package installation permitted', requiresApproval: true };
  }

  private isWithinWorkspace(target: string, workspaceDir: string): boolean {
    const resolved = isAbsolute(target) ? target : resolve(workspaceDir, target);
    const rel = relative(workspaceDir, resolved);
    return !rel.startsWith('..') && !isAbsolute(rel);
  }
}
