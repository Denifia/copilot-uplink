import { networkInterfaces, type NetworkInterfaceInfo } from 'node:os';

function isPrivateIpv4(address: string): boolean {
  const octets = address.split('.').map((part) => Number.parseInt(part, 10));
  if (octets.length !== 4 || octets.some((octet) => Number.isNaN(octet) || octet < 0 || octet > 255)) {
    return false;
  }

  return octets[0] === 10
    || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31)
    || (octets[0] === 192 && octets[1] === 168);
}

export function buildLocalIpUrl(address: string, port: number): string {
  const normalizedAddress = address.trim();
  if (!normalizedAddress) {
    throw new Error('Unable to determine local IP address');
  }

  return new URL(`http://${normalizedAddress}:${port}`).origin;
}

export function pickLanIpv4Address(
  interfaces: NodeJS.Dict<NetworkInterfaceInfo[]> = networkInterfaces(),
): string {
  const candidates = Object.entries(interfaces)
    .sort(([left], [right]) => left.localeCompare(right))
    .flatMap(([, infos]) => infos ?? [])
    .filter((info) => info.family === 'IPv4' && !info.internal && isPrivateIpv4(info.address));

  if (candidates.length === 0) {
    throw new Error('Unable to determine local IP address');
  }

  return candidates[0].address;
}

export function getLocalIpUrl(port: number): string {
  return buildLocalIpUrl(pickLanIpv4Address(), port);
}
