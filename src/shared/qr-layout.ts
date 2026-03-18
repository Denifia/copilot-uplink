export type QrSection = {
  label: string;
  url: string;
  qrCode: string;
};

export function formatQrSection(section: QrSection, leadingBlankLines = 1): string[] {
  const lines = Array.from({ length: leadingBlankLines }, () => '');
  const trimmedQr = section.qrCode.endsWith('\n') ? section.qrCode.slice(0, -1) : section.qrCode;

  lines.push(`  ${section.label}`);
  lines.push(`  ${section.url}`);
  lines.push('');
  lines.push(...trimmedQr.split('\n'));

  return lines;
}
