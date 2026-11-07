export type PortalChannel = { instance: string; canonical_phone: string };

export function canDisclosePortalIdentity(
  verified: boolean,
  roles: string[],
  channels: PortalChannel[],
  instance: string,
  canonicalPhone: string,
) {
  return (
    verified &&
    roles.includes("admin") &&
    channels.some(
      (channel) => channel.instance === instance && channel.canonical_phone === canonicalPhone,
    )
  );
}
