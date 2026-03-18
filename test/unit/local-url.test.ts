import { describe, expect, it } from 'vitest';
import { buildLocalIpUrl, pickLanIpv4Address } from '../../src/server/local-url.js';

describe('buildLocalIpUrl', () => {
  it('returns an IP-based URL origin', () => {
    expect(buildLocalIpUrl('192.168.1.50', 8123)).toBe('http://192.168.1.50:8123');
  });

  it('trims surrounding whitespace from the IP address', () => {
    expect(buildLocalIpUrl('  192.168.1.50  ', 3000)).toBe('http://192.168.1.50:3000');
  });

  it('throws when the IP address is blank', () => {
    expect(() => buildLocalIpUrl('   ', 3000)).toThrow('Unable to determine local IP address');
  });
});

describe('pickLanIpv4Address', () => {
  it('prefers a private, non-internal IPv4 address', () => {
    expect(pickLanIpv4Address({
      lo: [{ address: '127.0.0.1', netmask: '255.0.0.0', family: 'IPv4', mac: '00:00:00:00:00:00', internal: true, cidr: '127.0.0.1/8' }],
      ethernet: [
        { address: 'fe80::1', netmask: 'ffff:ffff:ffff:ffff::', family: 'IPv6', mac: '00:00:00:00:00:01', internal: false, cidr: 'fe80::1/64', scopeid: 1 },
        { address: '192.168.1.77', netmask: '255.255.255.0', family: 'IPv4', mac: '00:00:00:00:00:01', internal: false, cidr: '192.168.1.77/24' },
      ],
    })).toBe('192.168.1.77');
  });

  it('throws when no private LAN IPv4 address is available', () => {
    expect(() => pickLanIpv4Address({
      loopback: [{ address: '127.0.0.1', netmask: '255.0.0.0', family: 'IPv4', mac: '00:00:00:00:00:00', internal: true, cidr: '127.0.0.1/8' }],
      public: [{ address: '8.8.8.8', netmask: '255.255.255.0', family: 'IPv4', mac: '00:00:00:00:00:02', internal: false, cidr: '8.8.8.8/24' }],
    })).toThrow('Unable to determine local IP address');
  });
});
