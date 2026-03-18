import { describe, expect, it } from 'vitest';
import { formatQrSection } from '../../src/shared/qr-layout.js';

describe('formatQrSection', () => {
  it('formats a labeled QR section with the URL above the code', () => {
    expect(formatQrSection({
      label: 'Local network QR:',
      url: 'http://192.168.1.50:3000',
      qrCode: '██\n██\n',
    })).toEqual([
      '',
      '  Local network QR:',
      '  http://192.168.1.50:3000',
      '',
      '██',
      '██',
    ]);
  });

  it('supports extra leading blank lines between QR sections', () => {
    expect(formatQrSection({
      label: 'Tunnel QR:',
      url: 'https://example.devtunnels.ms',
      qrCode: 'BB\n',
    }, 4)).toEqual([
      '',
      '',
      '',
      '',
      '  Tunnel QR:',
      '  https://example.devtunnels.ms',
      '',
      'BB',
    ]);
  });
});
