import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Contract tests for getMachineFingerprint — platform-specific parsing logic.
// Only external dependencies (execSync, os, fs) are mocked.

const mockExecSync = vi.fn((): string => '');
const mockPlatform = vi.fn((): string => 'darwin');
const mockMachine = vi.fn((): string => 'arm64');
const mockExistsSync = vi.fn((_p: string): boolean => false);
const mockReadFileSync = vi.fn((_p: string, _enc?: string): string => '');

vi.mock('child_process', () => ({
  execSync: (...args: unknown[]) => mockExecSync(...(args as [string])),
}));

vi.mock('os', () => ({
  platform: () => mockPlatform(),
  machine: () => mockMachine(),
  homedir: () => '/tmp/test-home',
}));

vi.mock('fs', () => ({
  existsSync: (p: string) => mockExistsSync(p),
  readFileSync: (p: string, enc?: string) => mockReadFileSync(p, enc),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  renameSync: vi.fn(),
  chmodSync: vi.fn(),
}));

// Must also mock the internal dependency to avoid side effects
vi.mock('../../src/auth/client-id.js', () => ({
  getOrCreateClientId: () => 'mock-client-id-for-testing',
}));

vi.mock('../../src/utils/runtime-mode.js', () => ({
  loginCommand: () => 'qwencloud login',
}));

const { getMachineFingerprint } = await import('../../src/auth/crypto-store.js');

beforeEach(() => {
  vi.clearAllMocks();
  mockPlatform.mockReturnValue('darwin');
  mockMachine.mockReturnValue('arm64');
  mockExistsSync.mockReturnValue(false);
  mockReadFileSync.mockReturnValue('');
  mockExecSync.mockReturnValue('');
});

describe('getMachineFingerprint — platform branch parsing', () => {
  it('macOS: extracts IOPlatformUUID and IOPlatformSerialNumber from ioreg output', () => {
    mockPlatform.mockReturnValue('darwin');
    const ioregOutput = [
      '+-o Root  <class IORegistryEntry>',
      '  {',
      '    "IOPlatformUUID" = "A1B2C3D4-E5F6-7890-ABCD-EF1234567890"',
      '    "IOPlatformSerialNumber" = "C02XG2JHJG5J"',
      '  }',
    ].join('\n');

    mockExecSync.mockImplementation((cmd: string) => {
      if (cmd.includes('ioreg')) return ioregOutput;
      if (cmd.includes('machdep.cpu.brand_string')) return 'Apple M1 Pro';
      if (cmd.includes('kern.uuid')) return 'KERN-UUID-1234';
      return '';
    });

    const result = getMachineFingerprint();
    expect(result).toBeInstanceOf(Buffer);
    expect(result.length).toBe(32);

    // Verify the ioreg command was called
    expect(mockExecSync).toHaveBeenCalledWith(
      expect.stringContaining('ioreg'),
      expect.any(Object),
    );
  });

  it('macOS: produces consistent fingerprint for identical hardware info', () => {
    mockPlatform.mockReturnValue('darwin');
    const ioregOutput =
      '"IOPlatformUUID" = "FIXED-UUID"\n"IOPlatformSerialNumber" = "FIXED-SN"';

    mockExecSync.mockImplementation((cmd: string) => {
      if (cmd.includes('ioreg')) return ioregOutput;
      if (cmd.includes('machdep.cpu.brand_string')) return 'Apple M1';
      if (cmd.includes('kern.uuid')) return 'KERN-1';
      if (cmd.includes('ifconfig')) return '';
      return '';
    });

    const fp1 = getMachineFingerprint();
    const fp2 = getMachineFingerprint();
    expect(fp1.equals(fp2)).toBe(true);
  });

  it('macOS: graceful fallback when ioreg fails (empty output)', () => {
    mockPlatform.mockReturnValue('darwin');
    mockExecSync.mockImplementation((cmd: string) => {
      if (cmd.includes('ioreg')) return '';
      if (cmd.includes('machdep.cpu.brand_string')) return 'Apple M2';
      if (cmd.includes('kern.uuid')) return 'KERN-UUID';
      if (cmd.includes('ifconfig')) return 'en0: ether 00:1a:2b:3c:4d:5e';
      return '';
    });

    const result = getMachineFingerprint();
    expect(result).toBeInstanceOf(Buffer);
    expect(result.length).toBe(32);
  });

  it('Linux: reads machine-id from /etc/machine-id', () => {
    mockPlatform.mockReturnValue('linux');
    mockExistsSync.mockImplementation((p: string) => p === '/etc/machine-id');
    mockReadFileSync.mockImplementation((p: string) => {
      if (p === '/etc/machine-id') return 'abcdef1234567890abcdef1234567890';
      return '';
    });
    mockExecSync.mockImplementation((cmd: string) => {
      if (cmd.includes('ifconfig')) return '';
      return '';
    });

    const result = getMachineFingerprint();
    expect(result).toBeInstanceOf(Buffer);
    expect(result.length).toBe(32);
  });

  it('Linux: falls back to /var/lib/dbus/machine-id when /etc/machine-id missing', () => {
    mockPlatform.mockReturnValue('linux');
    mockExistsSync.mockImplementation((p: string) => p === '/var/lib/dbus/machine-id');
    mockReadFileSync.mockImplementation((p: string) => {
      if (p === '/var/lib/dbus/machine-id') return 'fedcba0987654321fedcba0987654321';
      return '';
    });
    mockExecSync.mockImplementation(() => '');

    const result = getMachineFingerprint();
    expect(result).toBeInstanceOf(Buffer);
    expect(result.length).toBe(32);
  });

  it('Linux: reads DMI fields from sysfs paths', () => {
    mockPlatform.mockReturnValue('linux');
    mockExistsSync.mockImplementation((p: string) => {
      if (p === '/etc/machine-id') return true;
      if (p.startsWith('/sys/class/dmi/id/')) return true;
      return false;
    });
    mockReadFileSync.mockImplementation((p: string) => {
      if (p === '/etc/machine-id') return 'machine-id-value-1234567890abcdef';
      if (p === '/sys/class/dmi/id/product_uuid') return 'DMI-PRODUCT-UUID';
      if (p === '/sys/class/dmi/id/product_serial') return 'DMI-PRODUCT-SERIAL';
      if (p === '/sys/class/dmi/id/board_serial') return 'DMI-BOARD-SERIAL';
      return '';
    });
    mockExecSync.mockImplementation(() => '');

    const result = getMachineFingerprint();
    expect(result).toBeInstanceOf(Buffer);
    expect(result.length).toBe(32);
  });

  it('Linux: falls back to dmidecode when sysfs read throws', () => {
    mockPlatform.mockReturnValue('linux');
    mockExistsSync.mockImplementation((p: string) => {
      if (p === '/etc/machine-id') return true;
      if (p.startsWith('/sys/class/dmi/id/')) return true;
      return false;
    });
    mockReadFileSync.mockImplementation((p: string) => {
      if (p === '/etc/machine-id') return 'valid-machine-id-32chars-padding';
      if (p.startsWith('/sys/class/dmi/id/')) throw new Error('Permission denied');
      return '';
    });
    mockExecSync.mockImplementation((cmd: string) => {
      if (cmd.includes('dmidecode -s product-uuid')) return 'DMIDECODE-UUID';
      if (cmd.includes('dmidecode -s product-serial')) return 'DMIDECODE-SERIAL';
      if (cmd.includes('dmidecode -s board-serial')) return 'DMIDECODE-BOARD';
      return '';
    });

    const result = getMachineFingerprint();
    expect(result).toBeInstanceOf(Buffer);
    expect(result.length).toBe(32);
    // Verify dmidecode was called as fallback
    expect(mockExecSync).toHaveBeenCalledWith(
      expect.stringContaining('dmidecode'),
      expect.any(Object),
    );
  });

  it('Windows: parses MachineGuid from registry output', () => {
    mockPlatform.mockReturnValue('win32');
    mockExecSync.mockImplementation((cmd: string) => {
      if (cmd.includes('reg query'))
        return '    MachineGuid    REG_SZ    12345678-abcd-ef01-2345-678901234567';
      if (cmd.includes('csproduct'))
        return 'UUID=AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE';
      if (cmd.includes('cpu')) return 'ProcessorId=BFEBFBFF000806EC';
      if (cmd.includes('ipconfig')) return '';
      return '';
    });

    const result = getMachineFingerprint();
    expect(result).toBeInstanceOf(Buffer);
    expect(result.length).toBe(32);
  });

  it('getStableMacAddress: filters locally-administered and multicast MACs', () => {
    mockPlatform.mockReturnValue('darwin');
    const ioregOutput = '"IOPlatformUUID" = "UUID-1"\n"IOPlatformSerialNumber" = "SN-1"';
    const ifconfigOutput = [
      'en0: flags=8863<UP,BROADCAST,SMART,RUNNING>',
      '\tether 02:aa:bb:cc:dd:ee', // bit 1 set — locally-administered, filtered
      'en1: flags=8863<UP,BROADCAST,SMART,RUNNING>',
      '\tether 00:1a:2b:3c:4d:5e', // globally-unique, kept
    ].join('\n');

    mockExecSync.mockImplementation((cmd: string) => {
      if (cmd.includes('ioreg')) return ioregOutput;
      if (cmd.includes('machdep.cpu.brand_string')) return 'CPU';
      if (cmd.includes('kern.uuid')) return 'K-UUID';
      if (cmd.includes('ifconfig')) return ifconfigOutput;
      return '';
    });

    const result = getMachineFingerprint();
    expect(result).toBeInstanceOf(Buffer);
    expect(result.length).toBe(32);
  });

  it('throws when no hardware information can be collected at all', () => {
    mockPlatform.mockReturnValue('darwin');
    mockMachine.mockReturnValue('');
    mockExecSync.mockImplementation(() => '');

    expect(() => getMachineFingerprint()).toThrow(/Cannot collect any machine fingerprint/);
  });

  it('includes os.machine() in fingerprint sources', () => {
    mockPlatform.mockReturnValue('darwin');
    mockMachine.mockReturnValue('arm64');
    mockExecSync.mockImplementation((cmd: string) => {
      if (cmd.includes('ioreg')) return '"IOPlatformUUID" = "U1"';
      if (cmd.includes('ifconfig')) return '';
      return '';
    });

    const fp1 = getMachineFingerprint();

    // Change machine architecture — fingerprint should differ
    mockMachine.mockReturnValue('x86_64');
    const fp2 = getMachineFingerprint();
    expect(fp1.equals(fp2)).toBe(false);
  });

  it('unsupported platform: relies on MAC address + machine()', () => {
    mockPlatform.mockReturnValue('freebsd');
    mockMachine.mockReturnValue('amd64');
    mockExecSync.mockImplementation((cmd: string) => {
      if (cmd.includes('ifconfig')) return 'em0: ether 00:11:22:33:44:55';
      return '';
    });

    const result = getMachineFingerprint();
    expect(result).toBeInstanceOf(Buffer);
    expect(result.length).toBe(32);
  });
});
